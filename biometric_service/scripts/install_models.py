"""Explicit, bounded download of two reviewed artifacts (no photos/datasets)."""
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))
from app.model_manifest import ARTIFACTS, checked_model_path, file_sha256


def install(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for key, artifact in ARTIFACTS.items():
        target = directory / artifact["filename"]
        if target.exists():
            checked_model_path(directory, key)
            print(f"{key}: verified existing artifact")
        else:
            request = urllib.request.Request(artifact["url"], headers={"User-Agent": "SafeEPI-model-installer/2"})
            temporary = None
            try:
                with urllib.request.urlopen(request, timeout=60) as response, tempfile.NamedTemporaryFile(dir=directory, delete=False) as output:
                    temporary = Path(output.name)
                    total = 0
                    while chunk := response.read(1024 * 1024):
                        total += len(chunk)
                        if total > artifact["size"]:
                            raise RuntimeError("model_download_too_large")
                        output.write(chunk)
                if total != artifact["size"] or file_sha256(temporary) != artifact["sha256"]:
                    raise RuntimeError("model_download_integrity_failed")
                temporary.replace(target)
                print(f"{key}: downloaded and SHA-256 verified")
            finally:
                if temporary and temporary.exists():
                    temporary.unlink()
        # Preserve required license notices alongside binaries.
        with urllib.request.urlopen(artifact["license_url"], timeout=30) as response:
            license_text = response.read(64_000)
        (directory / f"{key}.LICENSE").write_bytes(license_text)
    (directory / "manifest.json").write_text(json.dumps(ARTIFACTS, indent=2), encoding="utf-8")


if __name__ == "__main__":
    install(SERVICE_ROOT / "models")
