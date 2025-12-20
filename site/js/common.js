export function shorten(value) {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.length <= 12) return str;
  return str.slice(0, 4) + '…' + str.slice(-4);
}

export function isLocalLike() {
  return window.location.protocol === 'file:' || location.hostname === 'localhost';
}

// Статическая версия приложения, показываем в интерфейсе
export const appVersion = '1.0.12';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Lookup = {};
for(let i=0; i<base32Alphabet.length; i++) {
  base32Lookup[base32Alphabet[i]] = i;
}

export function decodeBase32(input) {
  input = input.replace(/=+$/, '');
  let length = input.length;
  let index = 0;
  let bits = 0;
  let value = 0;
  let output = new Uint8Array(Math.floor(length * 5 / 8));

  for (let i = 0; i < length; i++) {
    value = (value << 5) | base32Lookup[input[i]];
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 0xFF;
      bits -= 8;
    }
  }
  return output;
}

export function encodeBase32(data) {
    let output = '';
    let val = 0;
    let bits = 0;
    for (let i = 0; i < data.length; i++) {
        val = (val << 8) | data[i];
        bits += 8;
        while (bits >= 5) {
            output += base32Alphabet[(val >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += base32Alphabet[(val << (5 - bits)) & 31];
    }
    return output;
}

export function hexToBytes(hex) {
    if (!hex) return new Uint8Array(0);
    if (/^[0-9a-fA-F]+$/.test(hex)) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    }
    try {
        const binString = atob(hex);
        return Uint8Array.from(binString, c => c.charCodeAt(0));
    } catch (e) {
        return new Uint8Array(0);
    }
}

export function getHintFromAddress(address) {
     try {
       const bytes = decodeBase32(address);
       if (bytes.length < 33) return null;
       const hintBytes = bytes.slice(29, 33);
       return Array.from(hintBytes).map(b => b.toString(16).padStart(2, '0')).join('');
     } catch (e) {
       console.error('Error decoding address hint', address, e);
       return null;
     }
}

export function getMaskedHint(hexHint) {
      try {
          const hintBytes = hexToBytes(hexHint);
          if (hintBytes.length !== 4) return hexHint;

          const bytes = new Uint8Array(35);
          bytes[0] = 48;
          bytes.set(hintBytes, 29);

          const fullStr = encodeBase32(bytes);
          return 'G' + '-'.repeat(46) + fullStr.slice(47, 52) + '-'.repeat(4);
      } catch (e) {
          console.error(e);
          return hexHint;
      }
}

export function strKeyToBytes(strKey) {
    try {
        const bytes = decodeBase32(strKey);
        // Version byte (1) + Payload (32) + Checksum (2) = 35 bytes
        if (bytes.length < 35) return null;
        return bytes.slice(1, 33); // Return the 32-byte payload (hash)
    } catch (e) {
        return null;
    }
}

function crc16(buffer) {
    let crc = 0x0000;
    for (let i = 0; i < buffer.length; i++) {
        let byte = buffer[i];
        for (let j = 0; j < 8; j++) {
            const bit = ((byte >> (7 - j)) & 1) === 1;
            const c15 = ((crc >> 15) & 1) === 1;
            crc <<= 1;
            if (c15 ^ bit) crc ^= 0x1021;
        }
    }
    return crc & 0xFFFF;
}

export function encodeAddress(hexOrBytes) {
    let bytes;
    if (typeof hexOrBytes === 'string') {
        bytes = hexToBytes(hexOrBytes);
    } else {
        bytes = hexOrBytes;
    }
    
    if (!bytes || bytes.length !== 32) return null;

    const payload = new Uint8Array(35);
    payload[0] = 6 << 3; // 48
    payload.set(bytes, 1);
    
    const checksum = crc16(payload.slice(0, 33));
    payload[33] = checksum & 0xFF;
    payload[34] = (checksum >>> 8) & 0xFF;
    
    return encodeBase32(payload);
}
