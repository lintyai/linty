//! Uses the exact production inference path; prints text and measurements as JSON.
use linty_lib::reformat::{run, Options};
use std::path::Path;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = args.get(1).expect("usage: s1_bench MODEL_DIR [TRANSCRIPT]");
    let text = args.get(2).map(String::as_str).unwrap_or("um please send the report on friday no sorry monday and include the budget the timeline and the risks");
    let mut engine = None;
    for _ in 0..2 {
        let result = run(
            &mut engine,
            Path::new(dir),
            text,
            "en",
            Options {
                styling: "semi-formal".into(),
                structure: "lists".into(),
                context: "general".into(),
            },
            || false,
        );
        println!("{}", serde_json::to_string(&result).unwrap());
    }
}
