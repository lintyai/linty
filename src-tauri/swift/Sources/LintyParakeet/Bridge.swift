import Darwin
import FluidAudio
import Foundation

// C ABI consumed by src-tauri/src/parakeet.rs. Every function is synchronous:
// FluidAudio's API is async, so each call parks the calling thread on a
// semaphore until the underlying Task completes. Callers must therefore never
// invoke these from the main thread — Rust wraps them in spawn_blocking.
//
// Strings returned through `out_*` parameters are malloc'd and must be released
// with `linty_parakeet_free_string`.

/// A loaded Parakeet TDT model plus the actor that runs inference on it.
final class ParakeetEngine {
    let manager: AsrManager
    let models: AsrModels

    init(manager: AsrManager, models: AsrModels) {
        self.manager = manager
        self.models = models
    }
}

/// Result slot shared between the calling thread and the async Task.
private final class ResultBox<T>: @unchecked Sendable {
    var value: Result<T, Error>?
}

/// Run an async operation to completion from a synchronous, non-main thread.
private func runBlocking<T>(_ body: @escaping @Sendable () async throws -> T) -> Result<T, Error> {
    let box = ResultBox<T>()
    let semaphore = DispatchSemaphore(value: 0)
    Task.detached(priority: .userInitiated) {
        do {
            box.value = .success(try await body())
        } catch {
            box.value = .failure(error)
        }
        semaphore.signal()
    }
    semaphore.wait()
    return box.value ?? .failure(BridgeError.noResult)
}

private enum BridgeError: LocalizedError {
    case noResult
    case invalidArgument(String)

    var errorDescription: String? {
        switch self {
        case .noResult: return "Operation produced no result"
        case .invalidArgument(let what): return "Invalid argument: \(what)"
        }
    }
}

private func describe(_ error: Error) -> String {
    if let localized = (error as? LocalizedError)?.errorDescription {
        return localized
    }
    return String(describing: error)
}

private func setError(_ out: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?, _ message: String) {
    out?.pointee = strdup(message)
}

private func modelDirectory(_ path: UnsafePointer<CChar>) -> URL {
    URL(fileURLWithPath: String(cString: path), isDirectory: true)
}

/// C progress callback: (fraction in 0...1, opaque context).
public typealias LintyProgressFn = @convention(c) (Double, UnsafeMutableRawPointer?) -> Void

/// Wraps the C callback so it can cross into a @Sendable closure.
private struct ProgressSink: @unchecked Sendable {
    let fn: LintyProgressFn?
    let ctx: UnsafeMutableRawPointer?

    func report(_ fraction: Double) {
        fn?(fraction, ctx)
    }
}

// MARK: - Exports

/// 1 when this machine can run the CoreML Parakeet models (Apple Silicon).
@_cdecl("linty_parakeet_is_supported")
public func linty_parakeet_is_supported() -> Int32 {
    return SystemInfo.isAppleSilicon ? 1 : 0
}

/// 1 when a complete Parakeet TDT v3 bundle exists at `dir`.
@_cdecl("linty_parakeet_models_exist")
public func linty_parakeet_models_exist(_ dir: UnsafePointer<CChar>?) -> Int32 {
    guard let dir else { return 0 }
    return AsrModels.modelsExist(at: modelDirectory(dir), version: .v3) ? 1 : 0
}

/// Download (or verify) the Parakeet TDT v3 bundle into `dir`.
/// `progress` receives the download+compile fraction on an arbitrary thread.
@_cdecl("linty_parakeet_download")
public func linty_parakeet_download(
    _ dir: UnsafePointer<CChar>?,
    _ progress: LintyProgressFn?,
    _ ctx: UnsafeMutableRawPointer?,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?
) -> Int32 {
    guard let dir else {
        setError(outError, "missing model directory")
        return -1
    }
    let url = modelDirectory(dir)
    let sink = ProgressSink(fn: progress, ctx: ctx)

    let result = runBlocking { () -> URL in
        try await AsrModels.download(
            to: url,
            version: .v3,
            progressHandler: { snapshot in sink.report(snapshot.fractionCompleted) }
        )
    }

    switch result {
    case .success:
        return 0
    case .failure(let error):
        setError(outError, describe(error))
        return -1
    }
}

/// Load the bundle at `dir` onto the Neural Engine. Returns an opaque handle
/// that must be released with `linty_parakeet_free`, or NULL on failure.
@_cdecl("linty_parakeet_load")
public func linty_parakeet_load(
    _ dir: UnsafePointer<CChar>?,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?
) -> UnsafeMutableRawPointer? {
    guard let dir else {
        setError(outError, "missing model directory")
        return nil
    }
    let url = modelDirectory(dir)

    let result = runBlocking { () -> ParakeetEngine in
        let models = try await AsrModels.load(from: url, version: .v3)
        let manager = AsrManager()
        try await manager.loadModels(models)
        return ParakeetEngine(manager: manager, models: models)
    }

    switch result {
    case .success(let engine):
        return Unmanaged.passRetained(engine).toOpaque()
    case .failure(let error):
        setError(outError, describe(error))
        return nil
    }
}

/// Transcribe 16 kHz mono f32 samples. `language` is an optional ISO 639-1
/// code used as a script hint (v3 only); pass NULL for auto-detection.
/// Each call uses a fresh decoder state so utterances never bleed into each other.
@_cdecl("linty_parakeet_transcribe")
public func linty_parakeet_transcribe(
    _ handle: UnsafeMutableRawPointer?,
    _ samples: UnsafePointer<Float>?,
    _ count: UInt32,
    _ language: UnsafePointer<CChar>?,
    _ outText: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?,
    _ outProcessingSecs: UnsafeMutablePointer<Double>?,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?
) -> Int32 {
    guard let handle else {
        setError(outError, "engine not loaded")
        return -1
    }
    guard let samples, count > 0 else {
        setError(outError, "no audio samples")
        return -1
    }

    let engine = Unmanaged<ParakeetEngine>.fromOpaque(handle).takeUnretainedValue()
    let audio = Array(UnsafeBufferPointer(start: samples, count: Int(count)))
    let hint: Language? = language.flatMap { Language(rawValue: String(cString: $0)) }
    let decoderLayers = engine.models.version.decoderLayers

    let result = runBlocking { () -> ASRResult in
        var state = try TdtDecoderState(decoderLayers: decoderLayers)
        return try await engine.manager.transcribe(audio, decoderState: &state, language: hint)
    }

    switch result {
    case .success(let asr):
        outText?.pointee = strdup(asr.text)
        outProcessingSecs?.pointee = asr.processingTime
        return 0
    case .failure(let error):
        setError(outError, describe(error))
        return -1
    }
}

/// Release a handle returned by `linty_parakeet_load` and drop its CoreML models.
@_cdecl("linty_parakeet_free")
public func linty_parakeet_free(_ handle: UnsafeMutableRawPointer?) {
    guard let handle else { return }
    let engine = Unmanaged<ParakeetEngine>.fromOpaque(handle).takeRetainedValue()
    _ = runBlocking { () -> Void in
        await engine.manager.cleanup()
    }
}

@_cdecl("linty_parakeet_free_string")
public func linty_parakeet_free_string(_ s: UnsafeMutablePointer<CChar>?) {
    free(s)
}
