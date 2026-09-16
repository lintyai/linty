use super::*;
use serde_json::json;

fn cloud(value: serde_json::Value) -> String {
    serde_json::from_value::<GroqTranscription>(value)
        .unwrap()
        .into_text()
}

#[test]
fn ordinary_words_and_previously_blocked_phrases_survive_every_finalizer() {
    let phrases = [
        "I",
        "a",
        "no",
        "hi",
        "OK",
        "é",
        "你",
        "да",
        "sí",
        "you",
        "thank you",
        "thanks",
        "thanks for watching",
        "thank you for watching",
        "the end",
        "bye",
        "bye bye",
        "so",
        "okay",
        "the",
        "subtitles by the amara.org community",
        "subtitles by",
        "thanks for listening",
        "please subscribe",
        "subscribe",
        "like and subscribe",
        "see you next time",
        "Thank you.",
        "THANKS!",
    ];
    for phrase in phrases {
        for engine in ["Whisper", "Parakeet", "Parakeet vocabulary", "Cloud"] {
            assert_eq!(finish_transcript(&format!(" {phrase} \n"), engine), phrase);
        }
        assert_eq!(cloud(json!({"text": phrase})), phrase);
    }
}

#[test]
fn repetition_is_a_diagnostic_and_never_deletes_words() {
    for text in ["yes yes yes", "No, no, no!", "go GO go", "да да да"] {
        assert!(has_repeated_word(text), "{text}");
        assert_eq!(finish_transcript(text, "test"), text);
        assert_eq!(
            cloud(json!({"text": text, "segments": [{
                "text": text, "no_speech_prob": 0.95, "avg_logprob": -0.1
            }]})),
            text
        );
    }
    for text in [
        "",
        "... ... ...",
        "yes yes",
        "yes yes please",
        "no, I said no",
    ] {
        assert!(!has_repeated_word(text), "{text}");
    }
}

#[test]
fn digital_silence_does_not_reach_the_decoder() {
    assert!(!audio_has_signal(&[]));
    assert!(!audio_has_signal(&vec![0.0; 16000]));
    assert!(!audio_has_signal(&vec![1e-12; 16000]));
    assert!(!audio_has_signal(&[
        f32::NAN,
        f32::INFINITY,
        f32::NEG_INFINITY
    ]));
}

#[test]
fn quiet_signal_and_short_answers_surrounded_by_pauses_are_preserved() {
    // A quiet 100 ms signal, far below the old 0.01 RMS threshold.
    let quiet: Vec<f32> = (0..1600).map(|i| (i as f32 * 0.1).sin() * 0.0001).collect();
    assert!(audio_has_signal(&quiet));
    let mut paused = vec![0.0; 16000 * 120];
    paused[16000 * 60..16000 * 60 + quiet.len()].copy_from_slice(&quiet);
    assert!(audio_has_signal(&paused));
    // A non-window-aligned ending must not be ignored.
    let mut trailing = vec![0.0; 16000];
    trailing.extend_from_slice(&quiet[..399]);
    assert!(audio_has_signal(&trailing));
}

#[tokio::test]
async fn cloud_silence_returns_without_using_an_api_key_or_network() {
    assert_eq!(
        transcribe_cloud(&vec![0.0; 16000], "", None, None)
            .await
            .unwrap(),
        ""
    );
}

#[test]
fn cloud_requires_both_silence_and_low_confidence() {
    for (silence, confidence, expected) in [
        (0.95, -2.0, ""),
        (0.95, -0.1, "thank you"),
        (0.1, -2.0, "thank you"),
        (0.1, -0.1, "thank you"),
        (0.6, -2.0, "thank you"),
        (0.95, -1.0, "thank you"),
    ] {
        assert_eq!(
            cloud(json!({"text": "thank you", "segments": [{
                "text": "thank you", "no_speech_prob": silence, "avg_logprob": confidence
            }]})),
            expected,
            "silence={silence}, confidence={confidence}"
        );
    }
}

#[test]
fn repeated_text_needs_the_same_independent_evidence_as_any_other_text() {
    for text in ["yes yes yes", "The delivery arrives tomorrow."] {
        assert_eq!(
            cloud(json!({"text": text, "segments": [{
                "text": text, "no_speech_prob": 0.99, "avg_logprob": -2.0
            }]})),
            ""
        );
    }
}

#[test]
fn cloud_keeps_valid_segments_around_non_speech() {
    assert_eq!(
        cloud(json!({"text": "Hi. Noise. Thank you.", "segments": [
            {"text": "Hi.", "no_speech_prob": 0.01, "avg_logprob": -0.1},
            {"text": " Noise.", "no_speech_prob": 0.99, "avg_logprob": -2.0},
            {"text": " Thank you.", "no_speech_prob": 0.99, "avg_logprob": -0.1}
        ]})),
        "Hi. Thank you."
    );
}

#[test]
fn missing_or_partial_metadata_never_truncates_cloud_text() {
    for value in [
        json!({"text": "Hi. Thank you."}),
        json!({"text": "Hi. Thank you.", "segments": null}),
        json!({"text": "Hi. Thank you.", "segments": []}),
        json!({"text": "Hi. Thank you.", "segments": [{"text": "Hi. Thank you."}]}),
        json!({"text": "Hi. Thank you.", "segments": [{
            "text": "Hi. Thank you.", "no_speech_prob": 0.99, "avg_logprob": null
        }]}),
        json!({"text": "Hi. Thank you.", "segments": [{
            "text": "Hi. Thank you.", "no_speech_prob": null, "avg_logprob": -2.0
        }]}),
        json!({"text": "Hi. Thank you.", "segments": [{
            "text": "Hi.", "no_speech_prob": 0.99, "avg_logprob": -2.0
        }]}),
        json!({"text": "Hi. Thank you.", "segments": [{
            "no_speech_prob": 0.99, "avg_logprob": -2.0
        }]}),
    ] {
        assert_eq!(cloud(value), "Hi. Thank you.");
    }
}

#[test]
fn invalid_confidence_is_not_evidence_of_silence() {
    for (silence, confidence) in [
        (f32::NAN, -2.0),
        (f32::INFINITY, -2.0),
        (1.01, -2.0),
        (-0.1, -2.0),
        (0.99, f32::NAN),
        (0.99, f32::NEG_INFINITY),
        (0.99, f32::INFINITY),
    ] {
        assert!(!GroqSegment {
            text: "Hi".into(),
            no_speech_prob: Some(silence),
            avg_logprob: Some(confidence),
        }
        .is_no_speech());
    }
}
