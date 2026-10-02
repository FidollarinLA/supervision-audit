import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../web/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.json':'application/json' };
http.createServer(async (req,res) => {
 try {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const target = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!target.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  const data = await readFile(target); res.writeHead(200, {'Content-Type':types[extname(target)] || 'application/octet-stream', 'Cache-Control':'no-store'}); res.end(data);
 } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT || 4317),'127.0.0.1',()=>console.log('SupervisionAudit http://127.0.0.1:'+(process.env.PORT || 4317)));
