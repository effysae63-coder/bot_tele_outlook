






# 📱 **OUTLOOK BOT - COMPLETE COMMAND GUIDE**

## 📧 **ACCOUNT COMMANDS**

| Command | Example | Kaam Kya Hoga? |
|---------|---------|----------------|
| **/add** | `/add` | 🔗 Microsoft login link bhejega → Login karo → URL paste karo → Account connect ho jayega |
| **/list** | `/list` | 📋 Aapke sab accounts dikhayega (Active, Reconnect needed, Total rules etc) |
| **/status** | `/status zahid@outlook.com` | ℹ️ Account ka full details: Status, Rules, Blocked senders, Forward rules, Last backup |
| **/history** | `/history zahid@outlook.com` | 📜 Account ki 20 latest activities dikhayega (Block, Forward, Rule restore etc) |
| **/reconnect** | `/reconnect zahid@outlook.com` | 🔄 Token expire ho gaya hai to reconnect karega (Same process as /add) |
| **/remove** | `/remove zahid@outlook.com` | 🗑️ Account remove karega. **Auto-backup** bana ke rakh dega! |
| **/remove all** | `/remove all` | 🗑️🗑️ Aapke SAARE accounts ek saath remove karega. Sab ka backup banaega! |

---

## 🚫 **BLOCK COMMANDS**

| Command | Example | Kaam Kya Hoga? |
|---------|---------|----------------|
| **/block** | `/block spam@example.com` | 🔴 Is sender ki SAARI emails **FORWARD + DELETE** hogi. Forward target = `FORWARD_TARGET_EMAIL` |
| **/block** | `/block @ebay.com` | 🔴 Poora domain block! Kisi bhi eBay email address se aayi email → **FORWARD + DELETE** |
| **/block** | `/block zahid@outlook.com\|spam.com` | 🔴 Sirf **specific account** pe block karega. Doosre accounts safe! |
| **/block** | `/block all:spam.com` | 🔴 Aapke **SAARE accounts** pe ye domain block ho jayega |
| **/unblock** | `/unblock @ebay.com` | 🟢 Block hata dega. Ab eBay emails normally aayengi |
| **/unblock** | `/unblock spam@example.com` | 🟢 Specific sender ka block hataega |
| **/blocked** | `/blocked` | 📋 Aapke **saare accounts** ke blocked senders ki list dikhayega |
| **/blocked** | `/blocked zahid@outlook.com` | 📋 Sirf is account ke blocked senders dikhayega |
| **/check** | `/check ebay.com` | 🔍 Check karega: Ye domain kitne accounts pe blocked hai, kitne pe forward hai |

---

## 📨 **FORWARD COMMANDS**

| Command | Example | Kaam Kya Hoga? |
|---------|---------|----------------|
| **/forward** | `/forward @ebay.com friend@gmail.com` | 📤 Saari eBay emails **friend@gmail.com** par forward hogi. Original **DELETE** ho jayegi! |
| **/forward** | `/forward zahid@outlook.com work@gmail.com` | 📤 Sirf zahid@outlook.com ki emails **work@gmail.com** par forward hogi. Original DELETE! |
| **/forward off** | `/forward off @ebay.com` | 🛑 eBay ki **SAARI** forward rules hata dega. Ab forward nahi hogi |
| **/forward off** | `/forward off zahid@outlook.com\|work@gmail.com` | 🛑 Sirf **specific forward rule** hataega. Doosri forward rules rehti hain! |

---

## 📋 **RULE COMMANDS**

| Command | Example | Kaam Kya Hoga? |
|---------|---------|----------------|
| **/rules** | `/rules zahid@outlook.com` | 📋 Is account ki **saari rules** dikhayega. 🔒 = Sticky rule (auto-restore) |
| **/rule add** | `/rule add BlockShopify \| zahid@outlook.com \| sender:shopify.com \| action:delete` | ➕ Nayi rule banega: Shopify se aayi email **DELETE** ho jayegi |
| **/rule add** | `/rule add AmazonForward \| zahid@outlook.com \| subject:amazon \| forward:archive@gmail.com` | ➕ Subject mein "amazon" wali emails **archive@gmail.com** par forward hogi |
| **/rule add** | `/rule add GhostMode \| zahid@outlook.com \| sender:newsletter.com \| forward:archive@gmail.com \| action:delete` | 👻 **Ghost Mode**: Forward bhi + Delete bhi! |
| **/rule toggle** | `/rule toggle "BlockShopify" zahid@outlook.com` | 🔄 Rule ON hai to OFF karega, OFF hai to ON karega |
| **/rule remove** | `/rule remove "BlockShopify" zahid@outlook.com` | 🗑️ Rule delete karega. **Sticky rule** delete nahi ho sakti! |
| **/rule restore** | `/rule restore "BlockShopify" zahid@outlook.com` | ♻️ Delete ki hui rule wapas restore karega |
| **/rule backup** | `/rule backup zahid@outlook.com` | 💾 Is account ki saari rules database mein save karega |

---

## 💾 **BACKUP & RESTORE COMMANDS**

| Command | Example | Kaam Kya Hoga? |
|---------|---------|----------------|
| **/backup** | `/backup zahid@outlook.com` | 💾 Full backup: Rules + Blocked senders + Forward rules save hoga |
| **/backup all** | `/backup all` | 💾💾 Aapke **SAARE accounts** ka backup ek saath! |
| **/backups** | `/backups zahid@outlook.com` | 📋 Is account ke **saare backups** ki list dikhayega |
| **/restore** | `/restore zahid@outlook.com backup_1234567890` | ♻️ Backup wapas restore karega. Sab kuch waisa ho jayega jaisa backup time tha! |
| **/snapshot** | `/snapshot zahid@outlook.com` | 📸 Quick backup - Sirf current state save karega (Fast backup) |
| **/compare** | `/compare zahid@outlook.com backup_1234567890` | 🔍 Current state vs Backup mein kya difference hai? Dikhayega |
| **/auto backup** | `/auto backup zahid@outlook.com on` | ⚙️ **Daily 2:00 AM** auto backup ON |
| **/auto backup** | `/auto backup zahid@outlook.com off` | ⚙️ Auto backup OFF |
| **/delete backup** | `/delete backup zahid@outlook.com backup_1234567890` | 🗑️ Purana backup delete karega |

---

## 📊 **REPORTS & STATS COMMANDS**

| Command | Example | Kaam Kya Hoga? |
|---------|---------|----------------|
| **/report daily** | `/report daily` | 📈 **Aaj ka report**: Kitni rules enforce hui, kitne block hue, kitne errors etc |
| **/report weekly** | `/report weekly` | 📊 **7 din ka report**: Daily activity graph + weekly totals |
| **/report monthly** | `/report monthly` | 📉 **30 din ka report**: Week-wise breakdown + monthly analytics |
| **/report** | `/report zahid@outlook.com` | 📧 Sirf is account ka detailed report |
| **/summary** | `/summary` | 📋 **Quick overview**: Total accounts, active, reconnect, total rules etc |
| **/stats** | `/stats` | 🤖 **Bot ki performance**: Uptime, total accounts, total backups, response time |
| **/logs** | `/logs` | 📜 Sab accounts ki **recent 15 activities** |
| **/logs** | `/logs zahid@outlook.com` | 📜 Sirf is account ki recent activities |
| **/export json** | `/export json` | 📁 **JSON file** download hogi - All accounts data |
| **/export csv** | `/export csv` | 📁 **CSV file** (Excel) download hogi |
| **/export txt** | `/export txt` | 📁 **TXT file** download hogi |

---

# ⚡ **QUICK START - 3 EASY STEPS**

## 🟢 **STEP 1: Account Add Karein**
```
/add
```
👉 Link click karo → Login → URL paste karo

---

## 🔴 **STEP 2: Spam Block Karein**
```
/block @ebay.com
```
👉 Ab eBay ki saari emails **FORWARD + DELETE**!

---

## 📤 **STEP 3: Emails Forward Karein**
```
/forward @amazon.com friend@gmail.com
```
👉 Amazon ki saari emails friend@gmail.com par forward!

---

# ✅ **BOT READY HAI!**

**Koi confusion? Koi bhi command type karo, bot guide karega!** 🚀

---

*Ye command guide copy karo aur client ko bhejo. Bas itna hi chahiye!* 😎