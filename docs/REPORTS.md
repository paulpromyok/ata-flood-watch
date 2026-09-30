# เปิดระบบ "แจ้งน้ำท่วม" ของทีม (ทำครั้งเดียว ~10 นาที)

รายงานและรูปเก็บใน repo **ส่วนตัว** แยกจาก repo เว็บ (ซึ่งเป็นสาธารณะ) เพื่อไม่ให้รูปบ้าน/ถนนของผู้แจ้งเปิดเผยต่อสาธารณะ

1. GitHub → New repository → ชื่อ `ata-flood-reports` → เลือก **Private** → Create
2. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
   - Repository access: Only select repositories → `ata-flood-reports`
   - Permissions → Repository → **Contents: Read and write**
   - ตั้งวันหมดอายุ (เช่น 90 วัน) แล้วคัดลอก token
3. Vercel → โปรเจกต์ ata-flood-watch → Settings → Environment Variables → เพิ่ม
   - `REPORTS_REPO` = `paulpromyok/ata-flood-reports`
   - `REPORTS_TOKEN` = token จากข้อ 2
   - (ไม่บังคับ) `REPORT_PIN` = รหัสทีม ถ้าต้องการให้เฉพาะคนที่รู้รหัสแจ้งได้
4. แก้ `config.js` ใน repo เว็บ: `report_api: "/api/report"` → Commit (Vercel deploy เอง)

ตรวจ: เปิดเว็บ → แจ้งน้ำท่วม → ส่ง → จุด "!" ขึ้นบนแผนที่ และมีไฟล์ใหม่ใน `ata-flood-reports/reports/ปี/เดือน/วัน/`

ข้อมูลที่เก็บ: พิกัด ระดับ ความลึก หมายเหตุ (ระบบลบเบอร์โทรอัตโนมัติ) และรูปที่ย่อ/ลบข้อมูลตำแหน่งในไฟล์แล้ว ไม่เก็บชื่อหรือ IP ผู้แจ้ง
