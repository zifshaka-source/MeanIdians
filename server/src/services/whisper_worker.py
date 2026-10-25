import json
import os
import sys

try:
    from faster_whisper import WhisperModel
except ImportError:  # pragma: no cover - handled at runtime when dependency is unavailable
    WhisperModel = None  # type: ignore[assignment]

def _get_whisper_model():
    if WhisperModel is None:
        raise RuntimeError("faster-whisper is not installed. Install the server dependencies before running transcription.")
    return WhisperModel

def model_cache_status(model_size):
    if os.path.isdir(model_size):
        required_files = ("config.json", "model.bin", "tokenizer.json")
        missing = [name for name in required_files if not os.path.isfile(os.path.join(model_size, name))]
        if missing:
            return False, f"Whisper model directory is missing: {', '.join(missing)}."
        return True, None

    from huggingface_hub import try_to_load_from_cache

    repo_id = f"Systran/faster-whisper-{model_size}"
    required_files = ("config.json", "model.bin", "tokenizer.json")
    missing = []
    for name in required_files:
        cached_path = try_to_load_from_cache(repo_id, name)
        if not isinstance(cached_path, str) or not os.path.isfile(cached_path):
            missing.append(name)
    if missing:
        return False, (
            f"Whisper model '{model_size}' is not fully downloaded. "
            "Choose Download Whisper model in the desktop setup."
        )
    return True, None


def main():
    model_size = os.environ.get("WHISPER_MODEL", "small")
    if len(sys.argv) == 2 and sys.argv[1] == "--check":
        try:
            ready, error = model_cache_status(model_size)
            print(json.dumps({"ready": ready, "error": error}, ensure_ascii=False))
            return 0
        except Exception as error:
            print(json.dumps({"ready": False, "error": str(error)}, ensure_ascii=False))
            return 1

    if len(sys.argv) == 2 and sys.argv[1] == "--prepare":
        try:
            WhisperModel(model_size, device="cpu", compute_type="int8")
            print(json.dumps({"ready": True, "model": model_size}, ensure_ascii=False))
            return 0
        except Exception as error:
            print(json.dumps({"ready": False, "error": str(error)}, ensure_ascii=False))
            return 1

    if len(sys.argv) != 2:
        print(json.dumps({"error": "Expected an audio file path"}))
        return 2

    audio_path = sys.argv[1]
    if not os.path.isfile(audio_path):
        print(json.dumps({"error": "Audio file not found"}))
        return 2

    try:
        model = WhisperModel(
            model_size,
            device="cpu",
            compute_type="int8",
            local_files_only=os.environ.get("WHISPER_LOCAL_FILES_ONLY", "false").lower() == "true",
        )
        segments, info = model.transcribe(
            audio_path,
            beam_size=5,
            vad_filter=True,
        )
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
        print(json.dumps({
            "transcript": transcript,
            "hasSpeech": bool(transcript),
            "language": info.language,
        }, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
