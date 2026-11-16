import serial, sys, time

port = sys.argv[1]
secs = float(sys.argv[2]) if len(sys.argv) > 2 else 8

# 先設定 DTR/RTS 再開埠，避免開埠瞬間把 ESP32 拉進 reset
s = serial.Serial()
s.port = port
s.baudrate = 115200
s.timeout = 0.2
s.dtr = False
s.rts = False
s.open()

end = time.time() + secs
while time.time() < end:
    line = s.readline()
    if line:
        sys.stdout.write(line.decode("utf-8", "replace"))
        sys.stdout.flush()
s.close()
