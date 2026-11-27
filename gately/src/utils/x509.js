/**
 * 从 PEM 里读证书信息
 *
 * Gately 的 /api/ssl/certs 只给 certPem / issuerPem 这类原文，没有「到期时间」「域名」
 * 这种现成字段（和页面上的显示无关）。到期天数又是这个页面最要紧的数字，所以在这里
 * 做一次最小化的 X.509 解析：只取 notBefore / notAfter / SAN 里的域名 / 签发者 CN。
 *
 * 只用最必要的 ASN.1 规则，不求完整实现 —— 证书结构固定，够用就行。
 */

const OID_CN = '2.5.4.3';
const OID_SAN = '2.5.29.17';

/** 「-----BEGIN CERTIFICATE-----」包着的 base64 → 字节数组 */
function pemToBytes(pem) {
  const body = String(pem || '')
    .replace(/-----(BEGIN|END)[^-]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) return null;
  let bin;
  try {
    bin = atob(body);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 读一个 TLV 头 */
function tlv(b, p) {
  if (p + 2 > b.length) return null;
  const tag = b[p];
  let len = b[p + 1];
  let off = p + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (!n || n > 4) return null;
    len = 0;
    for (let i = 0; i < n; i += 1) {
      if (off >= b.length) return null;
      len = len * 256 + b[off];
      off += 1;
    }
  }
  if (off + len > b.length) return null;
  return { tag, body: off, end: off + len };
}

function text(b, node) {
  let s = '';
  for (let i = node.body; i < node.end; i += 1) s += String.fromCharCode(b[i]);
  return s;
}

function decodeOid(b, node) {
  const parts = [];
  let v = 0;
  for (let i = node.body; i < node.end; i += 1) {
    const byte = b[i];
    v = v * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(v);
      v = 0;
    }
  }
  if (!parts.length) return '';
  const first = parts.shift();
  return [Math.floor(first / 40), first % 40, ...parts].join('.');
}

/** UTCTime(0x17) / GeneralizedTime(0x18) → 毫秒时间戳 */
function readTime(b, node) {
  const s = text(b, node).trim();
  const m = s.match(/^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z?$/);
  if (!m) return 0;
  let year = Number(m[1]);
  if (m[1].length === 2) year += year < 50 ? 2000 : 1900;
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]) || 0, Number(m[5]) || 0, Number(m[6]) || 0);
}

/** 在 Name 里找 CN */
function findCn(b, node, depth = 0) {
  if (!node || depth > 6) return '';
  let p = node.body;
  while (p < node.end) {
    const item = tlv(b, p);
    if (!item) return '';
    if (item.tag === 0x06) {
      // OID 后紧跟同层的值
      const val = tlv(b, item.end);
      if (val && decodeOid(b, item) === OID_CN && (val.tag === 0x0c || val.tag === 0x13 || val.tag === 0x16)) {
        return text(b, val);
      }
    }
    if (item.tag === 0x31 || item.tag === 0x30) {
      const got = findCn(b, item, depth + 1);
      if (got) return got;
    }
    p = item.end;
  }
  return '';
}

const cache = new Map();
const CACHE_MAX = 40;

/**
 * 解析一张证书。
 * @returns {{notBefore:number, notAfter:number, domains:string[], issuer:string}|null}
 */
export function parseCertPem(pem) {
  const key = String(pem || '').slice(0, 64) + '|' + String(pem || '').length;
  if (cache.has(key)) return cache.get(key);

  let result = null;
  const b = pemToBytes(pem);
  if (b && b.length > 64) {
    try {
      const cert = tlv(b, 0); // Certificate ::= SEQUENCE
      const tbs = cert && tlv(b, cert.body); // TBSCertificate
      if (tbs) {
        let p = tbs.body;
        let item = tlv(b, p);
        if (item && item.tag === 0xa0) {
          // [0] EXPLICIT version，可省略
          p = item.end;
          item = tlv(b, p);
        }
        // serial → signature → issuer → validity → subject → spki → [3] extensions
        p = item ? item.end : p;
        p = tlv(b, p)?.end ?? p; // signature
        const issuerNode = tlv(b, p);
        p = issuerNode ? issuerNode.end : p;
        const validity = tlv(b, p);
        let notBefore = 0;
        let notAfter = 0;
        if (validity) {
          const nb = tlv(b, validity.body);
          const na = nb ? tlv(b, nb.end) : null;
          if (nb) notBefore = readTime(b, nb);
          if (na) notAfter = readTime(b, na);
          p = validity.end;
        }
        const domains = [];
        // 跳过 subject 与 SPKI，后面才是扩展
        const subject = tlv(b, p);
        p = subject ? subject.end : p;
        const spki = tlv(b, p);
        p = spki ? spki.end : p;
        // 个别证书会有 issuerUniqueID / subjectUniqueID，往后挪到 [3] 扩展为止
        let exts = tlv(b, p);
        for (let guard = 0; guard < 3 && exts && exts.tag !== 0xa3; guard += 1) {
          p = exts.end;
          exts = tlv(b, p);
        }
        if (exts && exts.tag === 0xa3) {
          const seq = tlv(b, exts.body);
          let x = seq ? seq.body : 0;
          const endX = seq ? seq.end : 0;
          while (x < endX) {
            const ex = tlv(b, x);
            if (!ex) break;
            let y = ex.body;
            const oid = tlv(b, y);
            if (oid) {
              y = oid.end;
              let val = tlv(b, y);
              if (val && val.tag === 0x01) {
                y = val.end;
                val = tlv(b, y);
              }
              if (val && val.tag === 0x04 && decodeOid(b, oid) === OID_SAN) {
                const inner = tlv(b, val.body);
                let z = inner ? inner.body : 0;
                const endZ = inner ? inner.end : 0;
                while (z < endZ) {
                  const gn = tlv(b, z);
                  if (!gn) break;
                  if (gn.tag === 0x82) domains.push(text(b, gn));
                  z = gn.end;
                }
              }
            }
            x = ex.end;
          }
        }
        result = {
          notBefore,
          notAfter,
          domains: [...new Set(domains.filter(Boolean))],
          issuer: issuerNode ? findCn(b, issuerNode) : '',
        };
      }
    } catch {
      result = null;
    }
  }

  if (cache.size > CACHE_MAX) cache.clear();
  cache.set(key, result);
  return result;
}

/** 证书的显示名：备注优先，其次第一个域名，最后退回 key */
export function certTitle(cert, parsed) {
  const note = String(cert?.remark || cert?.name || '').trim();
  if (note) return note;
  const d = parsed?.domains?.[0] || cert?.acme?.domains?.[0];
  if (d) return d.replace(/^\*\./, '*.');
  return String(cert?.key || '未命名证书');
}
