import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import requests


COMMIT = "f6bfb03f00358babc07bf6ec20899e85528887ce"
SET_NAME = "IGH_VDJ"
SPECIES = "Homo sapiens"
API_URL = "https://ogrdb.airr-community.org/api_v2"
ARTIFACTS = (
    "Homo_sapiens_IGH_VDJ_V.fasta",
    "Homo_sapiens_IGH_VDJ_D.fasta",
    "Homo_sapiens_IGH_VDJ_J.fasta",
    "Homo_sapiens_IGH_VDJ_V_gapped.fasta",
    "Homo_sapiens_IGH_VDJ.ndm",
    "Homo_sapiens_IGH_VDJ.aux",
)


class FixtureResponse:
    def __init__(self, path, entry, fixture_dir):
        self.path = path
        self.status_code = entry["status"]
        self.headers = entry["headers"]
        self.content = (fixture_dir / entry["file"]).read_bytes()
        self.text = self.content.decode("utf-8")
        self.url = "http://stage3-fixture" + path

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code} for {self.path}")

    def json(self):
        return json.loads(self.text)


def load_fixture(fixture_dir):
    manifest_path = fixture_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(
            f"{manifest_path} is missing; first run this script with --capture"
        )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = manifest["responses"]
    return manifest, entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", action="store_true", help="capture current published OGRDB responses")
    parser.add_argument("--source", type=Path, default=Path(__file__).parent / "receptor_utils-src")
    parser.add_argument("--fixture", type=Path, default=Path(__file__).parents[2] / "tests" / "fixtures" / "stage3" / "ogrdb")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "results" / "native")
    parser.add_argument("--api-url", default=API_URL)
    args = parser.parse_args()

    source = args.source.resolve()
    fixture_dir = args.fixture.resolve()
    output_dir = args.output.resolve()
    source_src = source / "src"
    if not source_src.is_dir():
        raise FileNotFoundError(f"receptor_utils source is missing: {source_src}")
    sys.path.insert(0, str(source_src))

    import requests as requests_module
    from scripts.download_germline_set import download_germline_set

    fixture_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in ARTIFACTS:
        target = output_dir / name
        if target.exists():
            target.unlink()

    original_get = requests_module.get
    responses = {}

    if args.capture:
        def capture_get(url, *call_args, **call_kwargs):
            response = original_get(url, *call_args, **call_kwargs)
            path = urlsplit(url).path
            if path.startswith("/api_v2/"):
                digest = hashlib.sha256(path.encode("utf-8")).hexdigest()[:16]
                suffix = ".fasta" if path.endswith(("/gapped_ex", "/ungapped_ex")) else ".json"
                name = f"response-{digest}{suffix}"
                (fixture_dir / name).write_bytes(response.content)
                responses[path] = {
                    "file": name,
                    "sha256": hashlib.sha256(response.content).hexdigest(),
                    "size": len(response.content),
                    "status": response.status_code,
                    "headers": {
                        "content-type": response.headers.get("content-type", ""),
                    },
                }
            return response

        requests_module.get = capture_get
        api_url = args.api_url.rstrip("/")
    else:
        manifest, responses = load_fixture(fixture_dir)
        api_url = "http://stage3-fixture/api_v2"

        def fixture_get(url, *call_args, **call_kwargs):
            path = urlsplit(url).path
            entry = responses.get(path)
            if entry is None:
                raise RuntimeError(f"No recorded OGRDB response for {path}")
            return FixtureResponse(path, entry, fixture_dir)

        requests_module.get = fixture_get

    try:
        os.chdir(output_dir)
        download_germline_set(
            SPECIES,
            "IGH",
            version="latest",
            germline_set_name=SET_NAME,
            file_format="MULTI-IGBLAST",
            url=api_url,
            prefix="Homo_sapiens_IGH_VDJ_",
        )
    finally:
        requests_module.get = original_get

    missing = [name for name in ARTIFACTS if not (output_dir / name).is_file()]
    if missing:
        raise RuntimeError(f"Reference preparation did not produce: {', '.join(missing)}")

    if args.capture:
        sets_path = next((p for p in responses if p.endswith("/germline/sets/9606")), None)
        if sets_path is None:
            raise RuntimeError("The live utility did not request the human germline-set list")
        sets_json = json.loads((fixture_dir / responses[sets_path]["file"]).read_text(encoding="utf-8"))
        set_entry = next(
            item for item in sets_json["germline_species"]
            if item.get("locus") == "IGH" and item.get("germline_set_name") == SET_NAME
        )
        manifest = {
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "api_base": API_URL,
            "species": SPECIES,
            "locus": "IGH",
            "set_name": SET_NAME,
            "set_id": set_entry["germline_set_id"],
            "receptor_utils_commit": COMMIT,
            "responses": responses,
        }
        (fixture_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )

    result = {
        "mode": "live-capture" if args.capture else "offline-fixture",
        "set_id": manifest["set_id"],
        "receptor_utils_commit": COMMIT,
        "artifacts": {},
    }
    for name in ARTIFACTS:
        data = (output_dir / name).read_bytes()
        result["artifacts"][name] = {
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    (output_dir / "manifest.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
