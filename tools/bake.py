"""Запекание процедурных текстур в public/textures/*.webp (ускоряет загрузку игры в разы).
Запуск (нужен python + playwright + chrome):  npm run build && npx vite preview --port 4173 &  python3 tools/bake.py
"""
import asyncio, base64, json, os, sys
from playwright.async_api import async_playwright

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures')
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173/?offline&bake'

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        names = set()
        # и ПК, и телефон — у них могут быть разные размеры текстур
        for vw, vh, mob in ((1280, 720, False), (390, 844, True)):
            pg = await b.new_page(viewport={'width': vw, 'height': vh}, is_mobile=mob, has_touch=mob)
            await pg.goto(URL); await pg.wait_for_timeout(9000)
            baked = await pg.evaluate('window.__baked || {}')
            for name, data in baked.items():
                raw = base64.b64decode(data.split(',', 1)[1])
                open(os.path.join(OUT, name), 'wb').write(raw)
                names.add(name)
                print(f'{name}: {len(raw) // 1024} KB')
            await pg.close()
        await b.close()
    json.dump({'files': sorted(names)}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    print('manifest:', len(names), 'files')

asyncio.run(main())
