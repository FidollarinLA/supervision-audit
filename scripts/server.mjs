import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(fileURLToPath(new URL('../web/', import.meta.url)));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.json':'application/json' };
export function createStaticServer() {
 return http.createServer(async (req,res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {Allow:'GET, HEAD'}); res.end(); return; }
  let target;
  try {
   const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
   target = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  } catch { res.writeHead(400); res.end('Invalid path'); return; }
  if (!target.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
   const data = await readFile(target);
   res.writeHead(200, {'Content-Type':types[extname(target)] || 'application/octet-stream', 'Cache-Control':'no-store'});
   res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found'); }
 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 const server=createStaticServer();
 server.listen(Number(process.env.PORT || 4317),'127.0.0.1',()=>console.log('SupervisionAudit http://127.0.0.1:'+server.address().port));
}
