// An uncompressed ZIP keeps every WAV in one browser download.
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ ((byte & 1) ? 0xedb88320 : 0);
  return byte;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

export async function zipFiles(files) {
  const encoder = new TextEncoder();
  const entries = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;

  for (const { blob, name } of files) {
    const filename = encoder.encode(name);
    const checksum = crc32(new Uint8Array(await blob.arrayBuffer()));

    const local = new Uint8Array(30 + filename.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true); // local file header
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // UTF-8 filename
    header.setUint16(12, 0x21, true); // DOS date: 1980-01-01
    header.setUint32(14, checksum, true);
    header.setUint32(18, blob.size, true);
    header.setUint32(22, blob.size, true);
    header.setUint16(26, filename.length, true);
    local.set(filename, 30);
    entries.push(local, blob);

    const central = new Uint8Array(46 + filename.length);
    const record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true); // central directory header
    record.setUint16(4, 20, true);
    central.set(local.subarray(4, 30), 6);
    record.setUint32(42, offset, true);
    central.set(filename, 46);
    directory.push(central);

    offset += local.length + blob.size;
    directorySize += central.length;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...entries, ...directory, end.buffer], { type: 'application/zip' });
}
