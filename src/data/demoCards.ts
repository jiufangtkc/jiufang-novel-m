import {
  BUILTIN_CATEGORY_CODES,
  CATEGORY_CHARACTER,
  CATEGORY_SUMMARY,
  CATEGORY_TIMELINE,
  CATEGORY_WORLD,
  resolveVisibleCategories,
} from '../domain/cardCategories';

export interface DemoCard {
  id: string;
  parent_id: string | null;
  category: string;
  title: string;
  content: string;
  color: string;
  is_collapsed: number;
  sort_order: number;
}

export interface CardCategory {
  id: string;
  name: string;
  sort_order: number;
}

/** 範例專案使用的固定自訂分類代碼（custom_ 加 8 碼小寫十六進位） */
export const DEMO_CUSTOM_CATEGORY_ID = 'custom_5ce4e001';

/** 範例自訂分類顯示名稱（照電腦版預設命名） */
export const DEMO_CUSTOM_CATEGORY_NAME = '自訂分類001';

/** 新開稿子的預設分類順序原始字串（電腦版預設順序，含隱藏的 ai_chat） */
export const DEFAULT_PROJECT_CATEGORY_ORDER_RAW = JSON.stringify(BUILTIN_CATEGORY_CODES);

/** 範例專案的分類順序原始字串（依電腦版格式，含 ai_chat） */
export const DEMO_CATEGORY_ORDER_RAW = JSON.stringify([
  ...BUILTIN_CATEGORY_CODES,
  DEMO_CUSTOM_CATEGORY_ID,
]);

/** 範例專案的展開分類原始字串 */
export const DEMO_EXPANDED_CATEGORIES_RAW: string | null = null;

/** 範例專案的自訂分類設定 JSON 字串（提供「自訂分類001」名稱） */
export const DEMO_CATEGORIES_META_RAW = JSON.stringify({
  [DEMO_CUSTOM_CATEGORY_ID]: DEMO_CUSTOM_CATEGORY_NAME,
});

/** 範例分類清單（由電腦版格式 category_order 與 categories_meta 推導，過濾 ai_chat） */
export const DEMO_CARD_CATEGORIES: CardCategory[] = resolveVisibleCategories({
  categoryOrder: DEMO_CATEGORY_ORDER_RAW,
  categoriesMeta: DEMO_CATEGORIES_META_RAW,
}).map(({ id, name, sort_order }) => ({
  id,
  name,
  sort_order,
}));

/**
 * 範例卡片資料（WO-53 電腦版分類代碼與 UUID 格式）
 * 規範要件：
 * 1. 一律稱「範例」，不談真假字眼。
 * 2. 角色「沈雨晴」、城市「霧港」。
 * 3. 分類代碼：summary、character、world、timeline、custom_5ce4e001（自訂分類001），每個分類 3～5 張。
 * 4. 所有卡片 id 為 UUID 格式；至少一張有兩層子卡片（沈雨晴 -> 隨身舊懷錶 -> 懷錶夾層的黑白照片，共三層）。
 * 5. 所有顏色皆為 #rrggbb（預設色為 #3C3F41，包含深色 #1a2b4c 以驗證對比調亮）。
 * 6. 至少一張內容很長（霧港地理與海潮氣候，測捲動與兩行摘要）。
 */
export const DEMO_CARDS: DemoCard[] = [
  // 本書綱要 summary (3 張)
  {
    id: '10000000-0000-4000-8000-000000000001',
    parent_id: null,
    category: CATEGORY_SUMMARY,
    title: '【範例】核心主線：燈塔熄滅之夜',
    content: `霧港北岬角的老燈塔在秋分夜無預警熄滅，引水人陸明遠在礁石區救起昏迷的沈雨晴。

雨晴身上唯一的線索，是一枚停在三點十七分的舊懷錶與半張浸濕的航海圖。兩人必須在下一場大潮來臨前，查明燈塔熄滅的原因與港務總署隱瞞的海潮異象。`,
    color: '#61afef',
    is_collapsed: 0,
    sort_order: 1,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    parent_id: null,
    category: CATEGORY_SUMMARY,
    title: '【範例】前半部轉折：失蹤的巡守紀錄簿',
    content: `雨晴與明遠潛入防波堤紅磚倉庫，發現十年前海潮大退事件的原始日誌早就被人抽換。

留下的巡守紀錄簿只剩最後一頁，上面用炭筆寫著：「霧氣不是從外海來的，是從港底升起的。」`,
    color: '#e5c07b',
    is_collapsed: 0,
    sort_order: 2,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    parent_id: null,
    category: CATEGORY_SUMMARY,
    title: '【範例】終局構想：潮聲重啟之時',
    content: `全書高潮落在冬至的大潮之夜。燈塔底部的地下水道被潮水灌滿，沈雨晴必須在水淹過胸口前，將懷錶機芯放回潮汐儀的齒輪中，讓警示鐘聲重新響徹整座霧港。`,
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 3,
  },

  // 角色 character (5 張，沈雨晴底下有兩層子卡片，總數 5 張)
  {
    id: '20000000-0000-4000-8000-000000000001',
    parent_id: null,
    category: CATEGORY_CHARACTER,
    title: '【範例】沈雨晴',
    content: `女主角，二十四歲，鐘錶修復師的養女。

性格冷靜內斂，對精密機械與齒輪聲響有異於常人的直覺。左手手腕有一道淺淺的舊傷痕，據說是十年前被海水衝上岸時留下的。為了尋找失蹤父親的下落而來到霧港。`,
    color: '#61afef',
    is_collapsed: 0,
    sort_order: 1,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    parent_id: '20000000-0000-4000-8000-000000000001',
    category: CATEGORY_CHARACTER,
    title: '【範例】隨身舊懷錶',
    content: `銀製雙蓋懷錶，指針永遠停在凌晨三點十七分。

外殼刻有繁複的海浪花紋，機芯構造特殊，並非一般發條擒縱，而是能感知潮汐變化的特製微型平衡輪。`,
    color: '#1a2b4c',
    is_collapsed: 0,
    sort_order: 1,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    parent_id: '20000000-0000-4000-8000-000000000002',
    category: CATEGORY_CHARACTER,
    title: '【範例】懷錶夾層的黑白照片',
    content: `藏在懷錶底蓋內側的微縮照片，邊緣微黃。

畫面中一位穿著老式引水人制服的中年男子抱著年幼的女孩，背景正是北岬角燈塔初建時的模樣。背面寫著淡墨小字：「晴兒，聽海潮的方向。」`,
    color: '#e5c07b',
    is_collapsed: 0,
    sort_order: 1,
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    parent_id: null,
    category: CATEGORY_CHARACTER,
    title: '【範例】陸明遠',
    content: `男主角，三十歲，霧港第三代首席引水人。

熟悉礁石分佈與每一股暗流，能在濃霧中僅憑水聲分辨航道。沉默寡言，平日住在南碼頭的舊駁船上，深受老船長們信任，但與港務總署官員關係緊張。`,
    color: '#98c379',
    is_collapsed: 0,
    sort_order: 2,
  },
  {
    id: '20000000-0000-4000-8000-000000000005',
    parent_id: null,
    category: CATEGORY_CHARACTER,
    title: '【範例】陳巡守',
    content: `五十八歲，港口巡守官，霧港的老好人。

看似整天拿著茶壺四處閒晃，實則掌握港區所有船隻進出暗帳。暗中照顧沈雨晴，似乎知曉十年前海難的不可告人內幕。`,
    color: '#e06c75',
    is_collapsed: 0,
    sort_order: 3,
  },

  // 世界觀 world (4 張，包含超長內容卡片)
  {
    id: '30000000-0000-4000-8000-000000000001',
    parent_id: null,
    category: CATEGORY_WORLD,
    title: '【範例】霧港地理與海潮氣候',
    content: `霧港坐落於半島東南側的天然深水峽灣，背靠懸崖，面朝波濤洶湧的黑潮主流。

由於地勢特殊，每年自初秋至翌年暮春，峽灣內部常年被一層濃厚的白色冷霧籠罩，當地人稱為「常霧季」。當常霧湧起時，海面能見度往往不足五米，即便正午陽光也僅能透出微弱的昏黃光暈。

港區主要劃分為三個區域：北岬角的燈塔與峭壁觀測哨、中央峽灣的貨運深水碼頭、以及南岸低窪錯落的棚戶漁港。在雨季與大潮相疊的時節，海水會順著古老的排水渠道倒灌進街道，居民外出皆需搭乘平底小木舟，造就了市街下層為水巷、上層為石橋連廊的獨特雙層立體格局。

此外，峽灣海面下的洋流極為兇險，暗礁叢生，若無經驗老道的引水人以號角聲測深領航，任何外來輪船都極易在黑礁岩上觸底擱淺。港灣底部更有深不可測的湧泉斷裂帶，傳聞每逢滿月退潮，底層海水會發出如鐘鳴般的共振低音，是整座港口維持運轉的神秘心跳。`,
    color: '#61afef',
    is_collapsed: 0,
    sort_order: 1,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    parent_id: null,
    category: CATEGORY_WORLD,
    title: '【範例】常霧現象',
    content: `霧港特有的氣候現象。每年秋分之後，由海溝深處上升的冷海水與陸地暖空氣交會，凝結成不散的濃霧。

霧中帶有微量海鹽與奇異的微光磷質，在夜晚能依稀看見光帶流動。`,
    color: '#98c379',
    is_collapsed: 0,
    sort_order: 2,
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    parent_id: null,
    category: CATEGORY_WORLD,
    title: '【範例】黑潮商會',
    content: `掌控全港貨物進出口、倉儲與煤炭配給的龐大商行組織。

對外維持合法商貿形象，暗地裡壟斷港口所有未登記航線，並全力封鎖任何關於「海底震動」的傳言。`,
    color: '#1a2b4c',
    is_collapsed: 0,
    sort_order: 3,
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    parent_id: null,
    category: CATEGORY_WORLD,
    title: '【範例】舊燈塔守則',
    content: `貼在北岬角燈塔二樓值班室木門後的斑駁守則：

一、日落前半小時必須添滿鯨油並點燃主燈。
二、起霧時每三分鐘鳴響氣笛一次。
三、若在霧中聽見笛聲回音延遲超過十秒，切勿回覆，即刻拉下防護鐵閘。
四、燈塔守夜人不得單獨直視午夜三點的海面。`,
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 4,
  },

  // 時間軸 timeline (3 張)
  {
    id: '40000000-0000-4000-8000-000000000001',
    parent_id: null,
    category: CATEGORY_TIMELINE,
    title: '【範例】十年前：海潮大退事件',
    content: `暴風雨之夜，港灣海水無故退潮三海浬，露出了從未見過的水下石階與古老閘門。

次日晨間海潮狂湧而回，造成三艘巨輪沉沒與老引水長失蹤，沈雨晴在退潮後的沙灘上被救起。`,
    color: '#e06c75',
    is_collapsed: 0,
    sort_order: 1,
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    parent_id: null,
    category: CATEGORY_TIMELINE,
    title: '【範例】三年前：沈雨晴初抵霧港',
    content: `沈雨晴完成鐘錶師學徒訓練，離開內陸城鎮，帶著養父留下的懷錶回到出生的霧港。

她在雨霧街租下一間臨河雜貨鋪的二樓，開始替老街坊修復受潮的各類儀表。`,
    color: '#61afef',
    is_collapsed: 0,
    sort_order: 2,
  },
  {
    id: '40000000-0000-4000-8000-000000000003',
    parent_id: null,
    category: CATEGORY_TIMELINE,
    title: '【範例】故事開始：秋分濃霧之夜',
    content: `北岬角燈塔於凌晨三點十七分無預警熄滅。外海一艘載有違禁貨物的輪船撞上暗礁，引水人陸明遠出海營救，自此拉開故事序幕。`,
    color: '#e5c07b',
    is_collapsed: 0,
    sort_order: 3,
  },

  // 自訂分類001 custom_5ce4e001 (3 張)
  {
    id: '50000000-0000-4000-8000-000000000001',
    parent_id: null,
    category: DEMO_CUSTOM_CATEGORY_ID,
    title: '【範例】第三號碼頭',
    content: `常年停靠老舊鐵殼蒸氣船的作業泊位。吊車生鏽的齒輪在海風中咯吱作響，空氣中瀰漫著重油、濕木材與海腥味。

碼頭盡頭有一處避風的棚架，是搬運工與引水人碰頭交換情報的據點。`,
    color: '#98c379',
    is_collapsed: 0,
    sort_order: 1,
  },
  {
    id: '50000000-0000-4000-8000-000000000002',
    parent_id: null,
    category: DEMO_CUSTOM_CATEGORY_ID,
    title: '【範例】雨霧街二十七號雜貨鋪',
    content: `兩層木造石基建築，一樓堆滿乾魚乾、煤油燈芯與纜繩，二樓是沈雨晴的工作室。

窗邊工作檯擺滿各式齒輪鑷子、放大鏡與酒精燈，抬頭便能望見峽灣出海口的微光。`,
    color: '#e5c07b',
    is_collapsed: 0,
    sort_order: 2,
  },
  {
    id: '50000000-0000-4000-8000-000000000003',
    parent_id: null,
    category: DEMO_CUSTOM_CATEGORY_ID,
    title: '【範例】防波堤盡頭的紅磚倉庫',
    content: `半世紀前由外國商行建造的連排紅磚庫房，地勢低窪，漲潮時海水會漫上一樓石階。

現被黑潮商會租用為特種貨物保稅倉，守衛森嚴，傳聞地下設有通往舊燈塔的暗道。`,
    color: '#1a2b4c',
    is_collapsed: 0,
    sort_order: 3,
  },
];

/** 建立一份獨立的範例卡片陣列複本 */
export function cloneDemoCards(): DemoCard[] {
  return DEMO_CARDS.map((card) => ({ ...card }));
}
