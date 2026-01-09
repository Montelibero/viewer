export const defaultHorizonURL = 'https://horizon.stellar.org';

export function getHorizonURL() {
    return localStorage.getItem('horizonURL') || defaultHorizonURL;
}

export function setHorizonURL(url) {
    if (!url) return;
    localStorage.setItem('horizonURL', url);
}

export function resetHorizonURL() {
    localStorage.removeItem('horizonURL');
}

export function initSettings() {
    const btn = document.getElementById('settings-btn');
    const modal = document.getElementById('settings-modal');
    const closeBtn = modal.querySelector('.delete');
    const cancelBtn = document.getElementById('cancel-settings-btn');
    const saveBtn = document.getElementById('save-settings-btn');
    const resetBtn = document.getElementById('reset-settings-btn');
    const input = document.getElementById('horizon-url-input');

    function openModal() {
        input.value = getHorizonURL();
        modal.classList.add('is-active');
    }

    function closeModal() {
        modal.classList.remove('is-active');
    }

    btn.onclick = openModal;
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    modal.querySelector('.modal-background').onclick = closeModal;

    saveBtn.onclick = () => {
        const url = input.value.trim();
        if (url) {
            setHorizonURL(url);
            closeModal();
            location.reload(); // Reload to apply changes
        }
    };

    resetBtn.onclick = () => {
        resetHorizonURL();
        input.value = defaultHorizonURL;
        closeModal();
        location.reload();
    };
}

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
// Injected by index.html template from Caddy
export const appVersion = window.APP_VERSION || 'DEV';

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

export function bytesToHex(bytes) {
    if (!bytes) return '';
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

export function decodeTextValue(input) {
    if (input === undefined || input === null) return { text: null, hex: null };

    // Determine if input is Base64 or Hex
    let bytes;
    let isHex = false;

    try {
        const binString = atob(input);
        bytes = Uint8Array.from(binString, c => c.charCodeAt(0));
    } catch (e) {
        // Not base64, maybe hex?
        if (/^[0-9a-fA-F]+$/.test(input) && input.length % 2 === 0) {
            bytes = hexToBytes(input);
            isHex = true;
        } else {
            return { text: null, hex: null, raw: input };
        }
    }

    const hex = bytesToHex(bytes);
    let text = null;

    if (typeof TextDecoder !== 'undefined') {
        try {
            // fatal: true ensures we don't return garbage/replacement chars for invalid sequences
            const decoder = new TextDecoder('utf-8', { fatal: true });
            text = decoder.decode(bytes);
        } catch (_) {
            text = null;
        }
    } else {
        // Fallback for very old browsers (unlikely)
        try {
            text = decodeURIComponent(escape(String.fromCharCode(...bytes)));
        } catch (_) {
            text = null;
        }
    }

    // Heuristic: if text has too many non-printable characters, treat as binary.
    // Allow tabs (09), newlines (0A), carriage returns (0D).
    // Range 00-08, 0B, 0C, 0E-1F are control chars.
    // 7F is DEL.
    // 80-9F are C1 control characters (rarely used in valid text, often indicate binary).
    if (text !== null) {
        // eslint-disable-next-line no-control-regex
        const badChars = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g);
        if (badChars && badChars.length > 0) {
            // If we have control characters, it's likely binary data, not text.
            text = null;
        }
    }

    return { text, hex };
}
