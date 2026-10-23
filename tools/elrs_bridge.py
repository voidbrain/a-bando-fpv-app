#!/usr/bin/env python3
"""
OpenBando bridge: ELRS / CRSF telemetry  ->  WebSocket (JSON)  for the OpenBando page.

A browser cannot read UDP, ESP-NOW or a serial telemetry stream by itself, so this small
program (Python 3, standard library only) reads it and re-publishes it as JSON over a WebSocket
that the page's "Live link" card connects to  (default  ws://localhost:8765 ).

  python elrs_bridge.py --simulate                 # fake flight around the site: test the page without any hardware
  python elrs_bridge.py --udp 14550 --dump         # listen for UDP packets and show what arrives (find out the format)
  python elrs_bridge.py --udp 14550                # forward telemetry from a UDP source (e.g. the ELRS backpack Wi-Fi)
  python elrs_bridge.py --tcp 192.168.4.1:5761     # forward telemetry from a TCP source
  python elrs_bridge.py --serial COM5 --baud 420000   # CRSF over a serial port (needs:  pip install pyserial)

It looks for valid CRSF frames (CRC-checked) anywhere in the incoming bytes, so it does not matter how
a transport wraps them. It decodes GPS, battery, attitude, flight mode and link statistics.
Open the page over http (for example:  python -m http.server 8000  and  http://localhost:8000/a-bando-fpv.html ).
"""
import argparse, asyncio, base64, hashlib, json, math, socket, struct, sys, threading, time

# ------------------------------------------------------------------ CRSF
def crc8(data, poly=0xD5):
    crc = 0
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ poly) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc

ADDRS = {0xC8, 0xEA, 0xEE, 0xEC, 0x00}          # flight controller, radio, TX module, receiver, broadcast

class Crsf:
    """Finds CRC-valid CRSF frames in a byte stream and keeps the latest decoded values in .state"""
    def __init__(self):
        self.buf = bytearray(); self.state = {}; self.frames = 0; self.lock = threading.Lock()

    def feed(self, data):
        with self.lock:
            self.buf += data
            if len(self.buf) > 4096:
                del self.buf[:-512]
            b, i, n = self.buf, 0, 0
            while i + 4 <= len(b):
                if b[i] in ADDRS and 2 <= b[i + 1] <= 62:
                    ln = b[i + 1]
                    if i + 2 + ln > len(b):
                        break                                   # frame not complete yet: wait for more bytes
                    body = bytes(b[i + 2:i + 2 + ln])           # type + payload + crc
                    if crc8(body[:-1]) == body[-1]:
                        self.decode(body[0], body[1:-1]); n += 1; i += 2 + ln
                        continue
                i += 1
            del b[:i]
            return n

    def decode(self, t, p):
        s = self.state; self.frames += 1
        try:
            if t == 0x02 and len(p) >= 15:                      # GPS
                lat, lon, spd, hdg, alt, sats = struct.unpack('>iiHHHB', p[:15])
                s.update(lat=lat / 1e7, lon=lon / 1e7, speed=spd / 10 / 3.6, heading=hdg / 100.0, alt=alt - 1000, sats=sats)
            elif t == 0x08 and len(p) >= 8:                     # battery
                v, c = struct.unpack('>HH', p[:4])
                s.update(vbat=v / 10.0, curr=c / 10.0, mah=int.from_bytes(p[4:7], 'big'), pct=p[7])
            elif t == 0x1E and len(p) >= 6:                     # attitude (radians * 10000)
                pit, rol, yaw = struct.unpack('>hhh', p[:6]); d = 180 / math.pi / 10000
                s.update(pitch=pit * d, roll=rol * d, yaw=yaw * d)
            elif t == 0x21:                                     # flight mode
                s['mode'] = p.split(b'\0')[0].decode('ascii', 'replace')
            elif t == 0x14 and len(p) >= 10:                    # link statistics
                s.update(rssi=-p[0], lq=p[2], snr=struct.unpack('b', p[3:4])[0], power=p[6])
        except Exception:
            pass

def frame(t, payload, addr=0xC8):
    body = bytes([t]) + payload
    return bytes([addr, len(body) + 1]) + body + bytes([crc8(body)])

def enc_gps(lat, lon, speed_ms, hdg, alt, sats):
    return frame(0x02, struct.pack('>iiHHHB', round(lat * 1e7), round(lon * 1e7), round(speed_ms * 3.6 * 10), round(hdg * 100) % 36000, max(0, int(alt + 1000)), sats))
def enc_batt(v, a, mah, pct):
    return frame(0x08, struct.pack('>HH', round(v * 10), round(a * 10)) + int(mah).to_bytes(3, 'big') + bytes([pct]))
def enc_att(pitch_deg, roll_deg, yaw_deg):
    k = math.pi / 180 * 10000
    return frame(0x1E, struct.pack('>hhh', round(pitch_deg * k), round(roll_deg * k), round(yaw_deg * k)))
def enc_mode(s):
    return frame(0x21, s.encode() + b'\0')
def enc_link(rssi, lq, snr, power):
    r, lq, snr, power = min(255, abs(int(round(rssi)))), int(lq) & 0xFF, int(snr) & 0xFF, int(power) & 0xFF
    return frame(0x14, bytes([r, r, lq, snr, 0, 4, power, r, lq, snr]))

# ------------------------------------------------------------------ sources
def udp_source(port, parser, dump):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('0.0.0.0', port)); print('listening for UDP on port', port)
    while True:
        data, addr = s.recvfrom(4096); n = parser.feed(data)
        if dump:
            print('%s  %3d bytes  %d CRSF frame(s)  %s%s' % (addr[0], len(data), n, data[:32].hex(' '), ' ...' if len(data) > 32 else ''))

def tcp_source(hostport, parser, dump):
    host, port = hostport.rsplit(':', 1)
    while True:
        try:
            s = socket.create_connection((host, int(port)), timeout=10); print('connected to', hostport)
            while True:
                data = s.recv(4096)
                if not data: break
                n = parser.feed(data)
                if dump: print('%3d bytes  %d CRSF frame(s)  %s' % (len(data), n, data[:32].hex(' ')))
        except Exception as e:
            print('tcp source:', e, '- retrying in 2 s'); time.sleep(2)

def serial_source(dev, baud, parser, dump):
    try:
        import serial
    except ImportError:
        sys.exit('pyserial is needed for --serial:  pip install pyserial')
    ser = serial.Serial(dev, baud, timeout=0.2); print('reading', dev, 'at', baud, 'baud')
    while True:
        data = ser.read(512)
        if data:
            n = parser.feed(data)
            if dump: print('%3d bytes  %d CRSF frame(s)  %s' % (len(data), n, data[:32].hex(' ')))

def simulate(parser):
    """A fake flight: loops around a point of the Chiari e Forti example, fed through real CRSF frames so the whole decode path is exercised."""
    lat0, lon0, t0, k = 45.64690, 12.30022, time.time(), 0
    print('simulating a flight around the site (fake data)')
    while True:
        t = time.time() - t0; ang = t * 0.18
        r = 38 + 10 * math.sin(t * .3)
        n, e = r * math.cos(ang), r * math.sin(ang)
        lat, lon = lat0 + n / 111132.0, lon0 + e / (111320.0 * math.cos(math.radians(lat0)))
        speed = r * 0.18 + 2
        hdg = (math.degrees(ang) + 90) % 360
        alt = 14 + 7 * math.sin(t * .5)
        parser.feed(enc_att(-12 + 4 * math.sin(t), 25 * math.sin(t * .7), hdg))
        if k % 2 == 0: parser.feed(enc_gps(lat, lon, speed, hdg, alt, 14))
        if k % 10 == 0:
            parser.feed(enc_batt(24.2 - t * .004, 18 + 6 * math.sin(t), 120 + t * 2, max(5, int(100 - t * .2))))
            parser.feed(enc_mode('ANGL' if int(t) % 20 < 10 else 'ACRO'))
            parser.feed(enc_link(-70 - 5 * math.sin(t), 100, 9, 3))
        k += 1; time.sleep(0.1)

# ------------------------------------------------------------------ WebSocket server (stdlib only)
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

def ws_frame(text, op=0x1):
    d = text.encode() if isinstance(text, str) else text; n = len(d)
    return bytes([0x80 | op]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack('>H', n)) + d

async def ws_handler(reader, writer, clients):
    try:
        req = await reader.readuntil(b'\r\n\r\n')
        h = {}
        for ln in req.decode('latin1').split('\r\n')[1:]:
            if ':' in ln:
                k, v = ln.split(':', 1); h[k.strip().lower()] = v.strip()
        if h.get('upgrade', '').lower() != 'websocket':
            body = b'OpenBando bridge is running. Connect a WebSocket to this port.\n'
            writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: %d\r\n\r\n' % len(body) + body)
            await writer.drain(); writer.close(); return
        acc = base64.b64encode(hashlib.sha1((h['sec-websocket-key'] + GUID).encode()).digest()).decode()
        writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n' % acc).encode())
        await writer.drain(); clients.add(writer); print('page connected (%d client)' % len(clients))
        while True:                                               # read frames only to notice close / ping
            hd = await reader.readexactly(2); op, ln = hd[0] & 0x0F, hd[1] & 0x7F
            if ln == 126: ln = int.from_bytes(await reader.readexactly(2), 'big')
            elif ln == 127: ln = int.from_bytes(await reader.readexactly(8), 'big')
            mask = await reader.readexactly(4) if hd[1] & 0x80 else b''
            data = await reader.readexactly(ln) if ln else b''
            if op == 8: break
            if op == 9: writer.write(ws_frame(data, 0xA)); await writer.drain()
    except Exception:
        pass
    finally:
        clients.discard(writer)
        try: writer.close()
        except Exception: pass

async def serve(parser, port, hz):
    clients = set()
    srv = await asyncio.start_server(lambda r, w: ws_handler(r, w, clients), '0.0.0.0', port)
    print('WebSocket on ws://localhost:%d  (enter this in the Live link card)' % port)
    last = -1
    async with srv:
        while True:
            await asyncio.sleep(1.0 / hz)
            if parser.frames == last or not clients: continue
            last = parser.frames
            with parser.lock: s = dict(parser.state)
            s['t'] = time.time()
            msg = ws_frame(json.dumps(s))
            for w in list(clients):
                try: w.write(msg)
                except Exception: clients.discard(w)

def main():
    ap = argparse.ArgumentParser(description='ELRS/CRSF telemetry -> WebSocket bridge for the OpenBando page')
    ap.add_argument('--udp', type=int, metavar='PORT'); ap.add_argument('--tcp', metavar='HOST:PORT')
    ap.add_argument('--serial', metavar='DEVICE'); ap.add_argument('--baud', type=int, default=420000)
    ap.add_argument('--simulate', action='store_true'); ap.add_argument('--dump', action='store_true', help='print every incoming packet')
    ap.add_argument('--ws-port', type=int, default=8765); ap.add_argument('--rate', type=float, default=10, help='messages per second to the page')
    a = ap.parse_args()
    if not (a.udp or a.tcp or a.serial or a.simulate):
        ap.print_help(); return
    p = Crsf()
    if a.simulate: threading.Thread(target=simulate, args=(p,), daemon=True).start()
    if a.udp: threading.Thread(target=udp_source, args=(a.udp, p, a.dump), daemon=True).start()
    if a.tcp: threading.Thread(target=tcp_source, args=(a.tcp, p, a.dump), daemon=True).start()
    if a.serial: threading.Thread(target=serial_source, args=(a.serial, a.baud, p, a.dump), daemon=True).start()
    try:
        asyncio.run(serve(p, a.ws_port, a.rate))
    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    main()
