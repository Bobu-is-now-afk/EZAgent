"""Structured, bounded UI adapter for bootstrap_local (standard library only)."""
import json
import os
import time
import urllib.request
from pathlib import Path
import bootstrap_local as b

HOST = b.DEFAULT_HOST
# Avoid proxy forwarding of local model requests.
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def emit(**event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def installed_models():
    try:
        with HTTP.open(HOST + '/api/tags', timeout=3) as response:
            return {item['name'] for item in json.load(response).get('models', [])}
    except Exception:
        return None


def config():
    if not b.CONFIG_PATH.exists():
        return {}
    data = json.loads(b.CONFIG_PATH.read_text(encoding='utf-8'))
    if not isinstance(data, dict):
        raise ValueError('invalid_config')
    return data


def inspect(requested=None):
    manifest = b.load_manifest()
    current = config()
    if current.get('ollama_host', HOST) != HOST:
        raise ValueError('nonlocal_config')
    ram = b.total_ram_gb()
    # Ollama's standard model cache lives on the home volume, not necessarily the repo volume.
    model_dir = Path(os.environ.get('OLLAMA_MODELS', str(Path.home() / '.ollama/models')))
    while not model_dir.exists() and model_dir != model_dir.parent:
        model_dir = model_dir.parent
    disk = b.free_disk_gb(model_dir)
    installed = installed_models()
    choices = []
    for model in manifest['models']:
        reason = None
        if model.get('blocked'):
            reason = 'blocked'
        elif ram is None or disk is None:
            reason = 'hardware_unknown'
        elif ram + .5 < model['min_ram_gb']:
            reason = 'memory'
        elif model['id'] not in (installed or set()) and disk < model['min_disk_gb']:
            reason = 'disk'
        choices.append({**model, 'available': reason is None, 'reason': reason})
    safe = [m for m in choices if m['available'] and m['tier'] != 'high_tier']
    preferred = next((m for m in safe if m['id'] == manifest['default_model_id']), None)
    preferred = preferred or next(iter(safe), None)
    selected = requested or current.get('model') or (preferred or {}).get('id')
    model = next((m for m in choices if m['id'] == selected), None)
    # A saved model that is no longer eligible must not strand a weak machine.
    if requested is None and (not model or not model['available']):
        model = preferred
    if not model or not model['available']:
        state = 'hardware_blocked'
    elif installed is None:
        state = 'engine_stopped' if b.which_ollama() or Path('/Applications/Ollama.app').exists() else 'install_required'
    elif model['id'] not in installed:
        state = 'model_missing'
    elif model['id'] != current.get('model', manifest['default_model_id']):
        state = 'selection_required'
    else:
        state = 'ready'
    return dict(state=state, model=model['id'] if model else None, models=choices,
                ram_gb=ram, disk_gb=disk, host=HOST, os=b.detect_os())


def save_config(model):
    # Never overwrite an unreadable config or discard unrelated fields.
    current = config()
    if current.get('ollama_host', HOST) != HOST:
        raise ValueError('nonlocal_config')
    current.update(schema_version=1, model=model, ollama_host=HOST,
                   os=b.detect_os(), source='scripts/bootstrap_local.py')
    b.EZAGENT_DIR.mkdir(parents=True, exist_ok=True)
    temp = b.CONFIG_PATH.with_suffix('.tmp')
    temp.write_text(json.dumps(current, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(b.CONFIG_PATH)


def run(args):
    try:
        status = inspect(args.model)
        if args.check_only:
            emit(**status)
            return 0
        if not args.yes:
            emit(state='consent_required')
            return 1
        if config().get('ollama_host', HOST) != HOST:
            emit(state='config_error')
            return 1
        if status['state'] in ('hardware_blocked', 'install_required'):
            emit(**status)
            return 1
        model = status['model']
        if status['state'] == 'engine_stopped':
            emit(state='starting')
            # Original helper prints human output; keep the structured channel clean.
            import contextlib
            import io
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                b.ensure_ollama_running(HOST)
        if model not in (installed_models() or set()):
            emit(state='downloading')
            request = urllib.request.Request(HOST + '/api/pull', data=json.dumps({'model': model, 'stream': True}).encode(), headers={'Content-Type': 'application/json'})
            deadline = time.monotonic() + 1800
            last_percent = -1
            with HTTP.open(request, timeout=60) as response:
                for line in response:
                    if time.monotonic() > deadline:
                        raise TimeoutError()
                    event = json.loads(line)
                    if event.get('error'):
                        raise RuntimeError('download_failed')
                    total = event.get('total', 0)
                    percent = min(100, max(0, int(event.get('completed', 0) * 100 / total))) if total else None
                    if percent != last_percent:
                        emit(state='downloading', percent=percent)
                        last_percent = percent
        if model not in (installed_models() or set()):
            raise RuntimeError('verification_failed')
        save_config(model)
        emit(**inspect(model))
        return 0
    except (ValueError, json.JSONDecodeError):
        emit(state='config_error')
    except Exception:
        # Do not leak raw subprocess output, URLs, paths or exception contents.
        emit(state='failed')
    return 1
