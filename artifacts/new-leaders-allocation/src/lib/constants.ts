export const SCOUT_EXPERTISE_OPTIONS = [
  "1. Handicrafts & Badge Crafts (手藝創作 / 徽章製作)",
  "2. Environmental & Nature Conservation (環保生態 / 自然觀察)",
  "3. Camping & Map/Compass Navigation (戶外露營 / 遠足導航)",
  "4. Water Sports & Canoeing/Swimming (水上活動 / 游泳獨木舟)",
  "5. Media, Photography & Graphic Design (影音製作 / 攝影 / 宣傳設計)",
  "6. Astronomy & Weather Observation (天文 / 氣象觀察)",
  "7. Pioneering & Pioneering Design (先鋒工程 / 繩結技能)",
  "8. Camp Cooking & Meal Logistics (野外烹飪 / 膳食籌劃)",
  "9. Drill & Ceremony Discipline (隊伍紀律 / 步操儀仗)",
  "10. Child Psychology & Youth Counseling (兒童心理 / 社工輔導)",
  "11. Administration & Secretarial (行政管理 / 檔案文書)",
  "12. Finance, Accounting & Budgeting (財務會計 / 預算控管)",
  "13. Quartermaster & Equipment Management (物資採購 / 裝備管理)",
  "14. Logistics & Transport Management (車隊運輸 / 物流統籌)",
  "15. MC, Games & Stage Performance (活動主持 / 團康司儀 / 遊戲帶領)",
  "16. First Aid & Health Safety (急救 / 衛生保健)",
  "17. IT, AI & Web Development (資訊科技 / AI 應用 / 網站開發)",
  "18. Housewife / Homemaker (全職家庭主婦/主夫)",
  "19. Student / Youth Leader (學生 / 青年領袖)",
  "20. Others / NA (其他 / 不適用)",
] as const;

export const SCOUT_EXPERTISE_TIERS = [
  { label: "P1–P2 foundation", start: 0, end: 1 },
  { label: "P3–P4 program", start: 2, end: 5 },
  { label: "P5–P6 priority", start: 6, end: 13 },
  { label: "Universal", start: 14, end: 19 },
] as const;