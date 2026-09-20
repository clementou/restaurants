#!/usr/bin/env python3
"""Import only the Want to go list from a shared Google Takeout folder."""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
from urllib.parse import urlencode, urlsplit, unquote
from urllib.request import Request, urlopen
import zipfile

PUBLIC = Path(__file__).resolve().parent / 'public' / 'google-maps.json'
MAX_ARCHIVE = 20 * 1024 * 1024
MAX_CSV = 10 * 1024 * 1024
SERVICE_ACCOUNT = 'takeout-reader@clementou-restaurants.iam.gserviceaccount.com'


def parse_list(contents):
    reader = csv.DictReader(io.StringIO(contents.decode('utf-8-sig')))
    if not {'Title', 'URL'}.issubset(reader.fieldnames or []):
        raise ValueError('Want to go CSV is missing Title or URL')
    places = {}
    for row in reader:
        name, url = (row.get('Title') or '').strip(), (row.get('URL') or '').strip()
        if not name and not url:
            continue
        parsed = urlsplit(url)
        if not name or parsed.scheme != 'https' or parsed.hostname not in {'www.google.com', 'google.com', 'maps.google.com'} or not parsed.path.startswith('/maps'):
            raise ValueError('Invalid Google Maps entry; retaining previous import')
        match = re.search(r'0x[0-9a-f]+:0x([0-9a-f]+)', unquote(url), re.I)
        cid = format(int(match[1], 16), 'x') if match else ''
        identifier = 'google-' + (cid or hashlib.sha256(url.encode()).hexdigest()[:20])
        places[identifier] = {
            'id': identifier, 'name': name, 'googleMapsUrl': url, 'googleCid': cid,
            'wantToGo': True, 'score': None, 'rank': None, 'addedAt': None,
            'category': 'OTHER', 'city': '', 'country': '', 'neighborhood': '',
            'cuisines': [], 'lat': None, 'lng': None, 'placeId': '',
        }
    if not places:
        raise ValueError('Empty Want to go list; retaining previous import')
    return sorted(places.values(), key=lambda p: p['id'])


def read_archive(contents):
    """Read one allowlisted member without extracting files to disk."""
    def wanted(name):
        return name.replace('\\', '/').endswith('/Saved/Want to go.csv')
    if zipfile.is_zipfile(io.BytesIO(contents)):
        with zipfile.ZipFile(io.BytesIO(contents)) as archive:
            for member in archive.infolist():
                if wanted(member.filename):
                    if member.file_size > MAX_CSV:
                        raise ValueError('Saved list exceeds size limit')
                    return parse_list(archive.read(member))
    else:
        with tarfile.open(fileobj=io.BytesIO(contents), mode='r:*') as archive:
            for member in archive:
                if member.isfile() and wanted(member.name):
                    if member.size > MAX_CSV:
                        raise ValueError('Saved list exceeds size limit')
                    return parse_list(archive.extractfile(member).read(MAX_CSV + 1))
    return None


def drive_get(path, token, params):
    request = Request('https://www.googleapis.com/drive/v3/' + path + '?' + urlencode(params),
                      headers={'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=90) as response:
        contents = response.read(MAX_ARCHIVE + 1)
    if len(contents) > MAX_ARCHIVE:
        raise ValueError('Drive response exceeds size limit')
    return contents


def import_folder(folder, token):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', folder):
        raise ValueError('Expected a Drive folder ID')
    files, page = [], None
    while True:
        params = {'q': f"'{folder}' in parents and trashed = false", 'pageSize': 100,
                  'fields': 'files(id,name,size),nextPageToken'}
        if page:
            params['pageToken'] = page
        result = json.loads(drive_get('files', token, params))
        files.extend(result.get('files', []))
        page = result.get('nextPageToken')
        if not page:
            break
    archives = [f for f in files if re.fullmatch(r'takeout-\d{8}T\d{6}Z.*\.(tgz|zip|tar\.gz)', f['name'])
                and int(f.get('size', MAX_ARCHIVE + 1)) <= MAX_ARCHIVE]
    for archive in sorted(archives, key=lambda f: f['name'], reverse=True):
        places = read_archive(drive_get('files/' + archive['id'], token, {'alt': 'media'}))
        if places:
            return places, archive['name']
    raise ValueError('No Want to go CSV found in the shared folder; export Saved in Takeout')


def write_export(places, source, output=PUBLIC):
    if output.exists():
        previous = json.loads(output.read_text())
        if previous.get('places') == places and previous.get('sourceArchive') == source:
            print(f'Want to go is unchanged ({len(places)} places).')
            return
    data = {'updatedAt': datetime.now(timezone.utc).isoformat(), 'sourceArchive': source, 'places': places}
    temporary = output.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    temporary.replace(output)
    print(f'Imported {len(places)} Want to go places. Notes and other lists were excluded.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--archive', type=Path)
    source.add_argument('--folder', help='Shared Drive folder ID')
    args = parser.parse_args()
    if args.archive:
        if args.archive.stat().st_size > MAX_ARCHIVE:
            raise ValueError('Archive exceeds size limit')
        places = read_archive(args.archive.read_bytes())
        if places is None:
            raise ValueError('Archive has no Want to go list')
        archive = args.archive.name
    else:
        token = os.environ.get('GOOGLE_DRIVE_ACCESS_TOKEN')
        if not token:
            token = subprocess.check_output([
                'gcloud', 'auth', 'print-access-token',
                '--impersonate-service-account=' + SERVICE_ACCOUNT,
                '--scopes=https://www.googleapis.com/auth/drive.readonly',
                '--project=clementou-restaurants'], text=True).strip()
        places, archive = import_folder(args.folder, token)
    write_export(places, archive)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Avoid exposing request headers or raw archive contents in CI logs.
        print(f'Google Maps import failed ({type(error).__name__}); previous snapshot retained.')
        raise SystemExit(1)
