# ATA Flood Watch

หน้าเว็บติดตามน้ำท่วมรอบออฟฟิศ ATA (เขตสะพานสูง) และกรุงเทพฯ–ปริมณฑล
GitHub Actions ดึงข้อมูลทุก 15 นาทีเก็บไว้ใน `data/` · หน้าเว็บโฮสต์บน Vercel และอ่านข้อมูลตรงจาก repo นี้

## มีอะไรบ้าง

- สรุปสถานการณ์รอบออฟฟิศ: ระดับเตือนภัยของเขต, จุดวัดน้ำเกินวิกฤต, น้ำท่วมบนถนน, เรื่องที่ประชาชนแจ้ง Traffy ในรัศมี 5 กม.
- แผนที่ OpenStreetMap: ระดับเขต, คลอง, จุดวัดน้ำ, น้ำท่วมบนถนน, Traffy, กล้อง, เรดาร์ฝน, ปุ่ม "ตำแหน่งฉัน"
- รายพื้นที่แยกตามจังหวัด (กรุงเทพฯ, สมุทรปราการ, นนทบุรี, ปทุมธานี, สมุทรสาคร) เรียงตามระยะจาก ATA หรือความรุนแรง
- หน้าเปิดค้างไว้จะโหลดข้อมูลใหม่ทุก 5 นาที

## ปรับค่า

แก้ `config.js` ไฟล์เดียว: ตำแหน่งศูนย์กลาง, วงรัศมี, รัศมีสรุป, รัศมีแสดง Traffy, ความถี่โหลดใหม่, ที่อยู่ข้อมูล (`data_base`)

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html`, `style.css`, `app.js`, `config.js` | หน้าเว็บ (Leaflet + OpenStreetMap) |
| `vercel.json` | ตั้งค่า Vercel: ข้ามการ build เมื่อ commit เปลี่ยนแค่ `data/` |
| `fetch_data.py` (+ `news_filter.py`, `places.py`) | ดึงข้อมูลทุกแหล่ง ประเมินระดับเขต เขียน `data/latest.json`, `data/traffy.json` |
| `build_geo.py` | สร้างเส้นคลอง/ถนนจาก OpenStreetMap (รันเดือนละครั้ง) |
| `scripts/check_data.py` | กันไม่ให้ commit ข้อมูลว่างเมื่อทุกแหล่งล่ม |
| `.github/workflows/floodwatcher.yml` | วนดึงข้อมูลทุก 15 นาที ~5.5 ชม. แล้วสั่งรอบถัดไปเอง |
| `.github/workflows/geo-layers.yml` | สร้างชั้นแผนที่ใหม่รายเดือน |

ต้องตั้ง Settings → Actions → General → Workflow permissions เป็น **Read and write** และ repo ต้องเป็น Public (Actions วนต่อเนื่องใช้นาทีเยอะ)

## แหล่งข้อมูล

ThaiWater (สสน.) ระดับน้ำและฝน · สำนักการระบายน้ำ กทม. ระดับน้ำคลอง ~280 จุด · Longdo Traffic / iTIC / กรมทางหลวง เหตุการณ์บนถนนและกล้อง ·
Traffy Fondue เรื่องที่ประชาชนแจ้ง · Open-Meteo พยากรณ์ฝน/อัตราการไหล · RainViewer เรดาร์ · Google News · GDACS

ระดับเขตคำนวณด้วยกฎอย่างง่าย **ไม่ใช่ประกาศทางการ**

## เครดิตและสัญญาอนุญาต

- ตัวดึงข้อมูล (`fetch_data.py`, `news_filter.py`, `places.py`, `build_geo.py`) และ workflow ดัดแปลงจาก
  [Floodwatcher โดย icyice1998](https://github.com/icyice1998/Flood) สัญญาอนุญาต MIT — ดู `upstream/FLOODWATCHER-LICENSE`
- ขอบเขตเขต เส้นคลอง ถนน และแผนที่ฐาน © OpenStreetMap contributors (ODbL)
- ข้อมูลจากแต่ละแหล่งเป็นของเจ้าของแหล่งนั้น การนำไปใช้เชิงพาณิชย์ต้องตรวจเงื่อนไขของแต่ละแหล่ง

© AT Technology Anywhere Co., Ltd.
