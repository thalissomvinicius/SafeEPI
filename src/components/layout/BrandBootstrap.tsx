import { headers } from "next/headers"

// Display-only cache. Authorization and company access are always checked by the server.
export const brandBootstrapSource = `(function(){try{var p=location.pathname;if(p==='/login'||p.indexOf('/delivery/remote')===0||p.indexOf('/training/remote')===0||p.indexOf('/capture')===0)return;var raw=localStorage.getItem('safeepi_active_brand');if(!raw)return;var brand=JSON.parse(raw);var c=brand.primaryColor;if(typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c))return;var n=parseInt(c.slice(1),16);var s='#'+[n>>16,(n>>8)&255,n&255].map(function(v){return Math.floor(v*.82).toString(16).padStart(2,'0')}).join('');document.body.classList.add('company-theme');document.body.style.setProperty('--brand-color',c);document.body.style.setProperty('--brand-color-strong',s)}catch(e){}})();`

export async function BrandBootstrap() {
  const nonce = (await headers()).get("x-nonce") || undefined
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: brandBootstrapSource }} />
}
