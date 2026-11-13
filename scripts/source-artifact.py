#!/usr/bin/env python3
"""Archive the exact reviewed source and index its locked public dependencies."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tomllib
import unicodedata

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def main():
    metadata = json.loads(Path(sys.argv[1]).read_text())
    output = Path(sys.argv[2]).resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError('Output must be outside the source tree')
    output.mkdir(parents=True, exist_ok=False)
    provenance = json.loads((ROOT / 'source-provenance.json').read_text())
    recorded = {entry['path']: entry['sha256'] for entry in provenance['files']}
    if len(recorded) != len(provenance['files']):
        raise ValueError('Duplicate source provenance path')
    expected = set(recorded) | {'source-provenance.json'}
    files, normalized, total = {}, {}, 0
    for row in filter(None, git('ls-tree', '-rz', 'HEAD').split(b'\0')):
        attrs, raw_name = row.split(b'\t', 1)
        mode, kind, oid = attrs.decode().split()
        name = raw_name.decode()
        if kind != 'blob' or mode not in {'100644', '100755'}:
            raise ValueError('Only regular reviewed source files are allowed: ' + name)
        parts = Path(name).parts
        for index in range(1, len(parts) + 1):
            prefix = '/'.join(parts[:index])
            key = unicodedata.normalize('NFC', prefix).casefold()
            if normalized.setdefault(key, prefix) != prefix:
                raise ValueError('Unicode/case source path collision')
        data = git('cat-file', 'blob', oid)
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or path.read_bytes() != data:
            raise ValueError('Working source differs from HEAD: ' + name)
        if len(data) > 10 * 1024 * 1024:
            raise ValueError('Source file exceeds 10 MiB: ' + name)
        total += len(data)
        files[name] = {'mode': mode, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        if name != 'source-provenance.json' and recorded.get(name) != files[name]['sha256']:
            raise ValueError('Reviewed source hash differs: ' + name)
    if set(files) != expected or total > 100 * 1024 * 1024:
        raise ValueError('Source allowlist or total size differs')
    lock = tomllib.loads((ROOT / 'server/Cargo.lock').read_text())
    locked = {(p['name'], p['version'], p['source']): p.get('checksum')
              for p in lock['package'] if p.get('source')}
    packages = []
    for package in metadata['packages']:
        if package['source'] is None:
            continue
        key = (package['name'], package['version'], package['source'])
        if not package.get('license') and not package.get('license_file'):
            raise ValueError('Dependency has no license declaration: ' + package['name'])
        source = package['source']
        if not (source == 'registry+https://github.com/rust-lang/crates.io-index'
                or any(source == 'git+' + p['url'] + '?rev=' + p['rev'] + '#' + p['rev']
                       for p in provenance['public_dependencies'].values())):
            raise ValueError('Unreviewed dependency source: ' + source)
        packages.append({'name': package['name'], 'version': package['version'],
                         'source': source, 'checksum': locked[key],
                         'license': package.get('license'),
                         'license_file': Path(package['license_file']).name if package.get('license_file') else None,
                         'repository': package.get('repository')})
    if {(p['name'], p['version'], p['source']) for p in packages} != set(locked):
        raise ValueError('Dependency inventory differs from Cargo.lock')
    npm = json.loads((ROOT / 'frontend/package-lock.json').read_text())
    npm_packages = []
    for name, package in npm['packages'].items():
        if not name:
            continue
        if not package['resolved'].startswith('https://registry.npmjs.org/') or not package.get('integrity'):
            raise ValueError('Unreviewed npm source: ' + name)
        licence = package.get('license')
        if name == 'node_modules/webgl-constants' and package['version'] == '1.1.1':
            if (ROOT / 'frontend' / name / 'LICENSE').read_bytes() != (ROOT / 'licenses/webgl-constants-MIT.txt').read_bytes():
                raise ValueError('Exact upstream webgl-constants licence differs')
            licence = 'MIT'
        if not licence:
            raise ValueError('Missing npm licence declaration: ' + name)
        npm_packages.append({'path': name, 'version': package['version'],
                             'source': package['resolved'], 'integrity': package['integrity'], 'license': licence})
    revision = git('rev-parse', 'HEAD').decode().strip()
    if revision != os.environ['GITHUB_SHA']:
        raise ValueError('Source commit differs from CI commit')
    raw = git('archive', '--format=tar', 'HEAD')
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        members = {member.name: member for member in archive.getmembers() if member.isfile()}
        if set(members) != expected:
            raise ValueError('Archived source closure differs')
        for name, info in files.items():
            if hashlib.sha256(archive.extractfile(members[name]).read()).hexdigest() != info['sha256']:
                raise ValueError('Archived bytes differ: ' + name)
    (output / 'w-power-twin-source.tar.gz').write_bytes(gzip.compress(raw, mtime=0))
    (output / 'THIRD-PARTY-DEPENDENCIES.json').write_text(json.dumps({
        'scope': 'Complete Cargo/npm locks, all target platforms; declarations only; no dependency code redistributed',
        'npm': npm_packages,
        'cargo': sorted(packages, key=lambda p: (p['name'], p['version'], p['source']))}, indent=2) + '\n')
    (output / 'SOURCE.json').write_text(json.dumps({
        'commit': revision, 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
        'repository': os.environ['GITHUB_REPOSITORY'], 'files': files,
        'scope': provenance['distribution'],
        'licenses': ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'licenses/webgl-constants-MIT.txt'],
        'compiled_binaries_included': False, 'external_assets_and_datasets_included': False,
        'field_device_acceptance': False, 'browser_acceptance': False,
        'production_activation': False}, indent=2) + '\n')
    (output / 'SHA256SUMS').write_text(''.join(
        hashlib.sha256((output / name).read_bytes()).hexdigest() + '  ' + name + '\n'
        for name in ['w-power-twin-source.tar.gz', 'SOURCE.json', 'THIRD-PARTY-DEPENDENCIES.json']))
    print(f'Archived {len(files)} source files, {total} bytes, {len(packages)} Cargo and {len(npm_packages)} npm declarations, {revision}')


if __name__ == '__main__':
    main()
