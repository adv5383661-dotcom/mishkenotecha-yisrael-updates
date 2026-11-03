/* ==========================================================================
   Mishkenotecha Yisrael — Book studio ("עימוד ספר").
   Loaded on demand by the main page (GET /book/book.js). Shipped as .txt
   because an update package may only carry .py/.json/.txt/.md files.

   What it does, in the spirit of the classic sefarim typesetters ("תג"):
     * a book = sections (שער/הקדמה/הסכמה/פרק/סימן/טקסט) with plain text;
       inline marks: {הערה} footnote, {{מקור}} second note series,
       *מודגש*, "# כותרת משנה", "= שורה במרכז", "***" separator;
     * a real pagination engine: justified text, notes kept on the page of
       their reference (two independent note series, 1-3 columns, a long
       note continues on the next page), widow/orphan control, heading kept
       with its text, running heads, Hebrew page numbers, chapter openers,
       catchwords (שומר הדף), title page, table of contents;
     * the same pages are printed to PDF by Edge headless (/api/book/pdf).
   ========================================================================== */
(function(){
"use strict";

const CANCELLED = {cancelled: true};
const MM = 96 / 25.4;
let APP = {api: null, toast: null, token: ""};

/* ------------------------------------------------------------------ utils */
const sleep0 = () => new Promise(r => setTimeout(r, 0));
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function h(tag, attrs, html){
  const e = document.createElement(tag);
  if(attrs) for(const k in attrs){
    if(k === "class") e.className = attrs[k];
    else if(k === "text") e.textContent = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  if(html != null) e.innerHTML = html;
  return e;
}
function uid(p){ return (p || "s") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function debounce(fn, ms){
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { clearTimeout(t); t = null; return fn(...a); };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}
function toast(msg, kind){ if(kind === "warn" || kind === "err") trail("toast", {kind, msg:String(msg || "").slice(0, 160)}); try{ if(APP.toast) APP.toast(msg, kind); }catch(e){} }
// A footprint of what was pressed in the book studio (button names only, never the text typed),
// so Eli can see afterwards where Abba went and where he got stuck. It goes to logs/book_trail.jsonl,
// which the app already sends to Eli with its other logs.
const TRAIL = {buf:[], t:null, last:"", lastAt:0, rep:0};
function trail(ev, d){
  try{
    let where = "";
    const M = document.getElementById("bkModal"), D = document.getElementById("bkDialog");
    if(M && !M.hidden && D){
      const h = D.querySelector("h3"), st = D.querySelector(".bk-wizstep.on,.bk-wizstep[aria-current]");
      where = ((h ? h.textContent : "חלון") + (st ? " › " + st.textContent : "")).replace(/\s+/g, " ").trim().slice(0, 60);
    }else where = "לשונית " + (typeof currentTab === "string" ? currentTab : "");
    TRAIL.buf.push(Object.assign({ts:+(Date.now() / 1000).toFixed(1), ev, where}, d || {}));
    if(TRAIL.buf.length > 300) TRAIL.buf.splice(0, TRAIL.buf.length - 300);
    clearTimeout(TRAIL.t); TRAIL.t = setTimeout(trailFlush, 6000);
  }catch(e){}
}
function trailFlush(){
  clearTimeout(TRAIL.t);
  if(!TRAIL.buf.length || !APP.token) return;
  const ev = TRAIL.buf.splice(0);
  try{ fetch("/api/book/trail", {method:"POST", keepalive:true, headers:{"Content-Type":"application/json", "X-Mishkenotecha-Token":APP.token}, body:JSON.stringify({ev})}).catch(() => {}); }catch(e){}
}
document.addEventListener("click", (e) => {
  try{
    const b = e.target.closest && e.target.closest("button,[role=button],a,label,.bk-tp,.bk-tpfree,.bk-tpi,[data-hubp],[data-pick]");
    if(!b || !b.closest("#bkRoot,#bkModal")) return;
    const name = ((b.textContent || "").replace(/\s+/g, " ").trim() || b.title || b.getAttribute("aria-label") || b.className || b.tagName).slice(0, 50);
    const now = Date.now();
    // the same thing pressed again and again in a few seconds = it did not do what he expected
    if(name === TRAIL.last && now - TRAIL.lastAt < 4000){ TRAIL.rep++; TRAIL.lastAt = now; if(TRAIL.rep === 2 || TRAIL.rep === 5) trail("again", {name, times:TRAIL.rep + 1}); return; }
    TRAIL.last = name; TRAIL.lastAt = now; TRAIL.rep = 0;
    trail("click", {name});
  }catch(err){}
}, true);
document.addEventListener("keydown", (e) => {
  if((e.ctrlKey || e.metaKey) && e.code === "KeyJ" && document.getElementById("bkRoot") && typeof window.__bkFnFind === "function"){ e.preventDefault(); e.stopPropagation(); window.__bkFnFind(); return; }
  if(!(e.ctrlKey || e.metaKey) || !/^[zy]$/i.test(e.key)) return;
  if(e.target.closest && e.target.closest("#bkRoot,#bkModal")) trail("key", {name:"Ctrl+" + e.key.toUpperCase()});
}, true);
window.addEventListener("error", (e) => { try{ if(String(e.filename || "").indexOf("book") >= 0 || !e.filename) trail("error", {msg:String(e.message || "").slice(0, 200), line:e.lineno}); }catch(err){} });
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "hidden") trailFlush(); });
window.addEventListener("pagehide", trailFlush);
const $ = (id) => document.getElementById(id);
function lsGet(k, d){ try{ const v = localStorage.getItem(k); return v == null ? d : v; }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }

/* --------------------------------------------------------- Hebrew numbers */
const G_ONES = ["","א","ב","ג","ד","ה","ו","ז","ח","ט"];
const G_TENS = ["","י","כ","ל","מ","נ","ס","ע","פ","צ"];
const G_HUND = ["","ק","ר","ש","ת","תק","תר","תש","תת","תתק"];
const G_FIX = {"רע":"ער","רעב":"ערב","רעד":"עדר","רעה":"ערה","רצח":"רחצ","שד":"דש","שמד":"שדמ","תשמד":"תשדמ"};
function gem(n){
  n = Math.floor(n);
  if(!(n > 0)) return "";
  let pre = "";
  if(n >= 1000){ pre = gem(Math.floor(n / 1000)) + "'"; n %= 1000; if(!n) return pre; }
  const hu = Math.floor(n / 100), r = n % 100;
  let s = G_HUND[hu];
  if(r === 15) s += "טו";
  else if(r === 16) s += "טז";
  else s += G_TENS[Math.floor(r / 10)] + G_ONES[r % 10];
  return pre + (G_FIX[s] || s);
}

/* ------------------------------------------------- the daf in the Gemara */
// Which daf a section deals with: sec.daf (a number) + sec.amud ("א" / "ב" / ""),
// printed the way the sefarim print it: "דף ה׳ ע״א", "דף כ״ד ע״ב".
function dafNum(n){ const g = gem(n); return g.length > 1 ? g.slice(0, -1) + "״" + g.slice(-1) : g + "׳"; }
// fmt (סגנונות ← הדף בגמרא ← "איך כותבים"): "" דף ה׳ ע״א · "dots" דף ה. / דף ה: ·
// "short" ה׳ ע״א · "words" דף ה׳ עמוד א׳
function dafLabel(sec, fmt){
  const n = sec ? parseInt(sec.daf, 10) : 0;
  if(!(n > 0)) return "";
  const a = sec.amud === "א" || sec.amud === "ב" ? sec.amud : "";
  if(fmt === "dots") return "דף " + (a ? gem(n) + (a === "א" ? "." : ":") : dafNum(n));
  if(fmt === "short") return dafNum(n) + (a ? " ע״" + a : "");
  if(fmt === "words") return "דף " + dafNum(n) + (a ? " עמוד " + a + "׳" : "");
  return "דף " + dafNum(n) + (a ? " ע״" + a : "");
}
// How the daf heading looks -- taken from the same sefarim (אוצר החכמה) the "שיעורים"
// templates follow; each daf template prints the daf the way its own book does.
// [key, name, the book it comes from]
const DAF_LOOKS = [
  ["star", "קטנה אחרי ★ ☆ ★", "שיעורי רבי אבא ורבי אברהם יצחק"],
  ["outline", "חלולה בתוך הטור", "שיעורים יומיים"],
  ["ornate", "בין קווים מעוטרים", "שיעורי רבי אליעזר מנשה"],
  ["square", "באותיות מרובעות", "שיעורי רבי אהרן ורבי דוד ליפשיץ"],
  ["siman", "קטנה, ולפניה רווח לבן", "שיעורי רבי ברוך שמואל"],
  ["plain", "מודגשת", ""], ["orn", "עם ❖", ""], ["lines", "בין קווים", ""], ["frame", "במסגרת", ""], ["banner", "פס שחור", ""],
];
const DAF_LOOK_OF_TEMPLATE = {daf:"star", daf1:"star", dafOutline:"outline", dafOrnate:"ornate", dafRashi:"square", dafSiman:"siman"};
function dafLookOf(st){
  const v = st.dafLook;
  return v && DAF_LOOKS.some(x => x[0] === v) ? v : (DAF_LOOK_OF_TEMPLATE[st.template] || "plain");
}
const MASECHTOT = ["ברכות","שבת","עירובין","פסחים","שקלים","יומא","סוכה","ביצה","ראש השנה","תענית","מגילה",
  "מועד קטן","חגיגה","יבמות","כתובות","נדרים","נזיר","סוטה","גיטין","קידושין","בבא קמא","בבא מציעא","בבא בתרא",
  "סנהדרין","מכות","שבועות","עבודה זרה","הוריות","זבחים","מנחות","חולין","בכורות","ערכין","תמורה","כריתות",
  "מעילה","תמיד","נדה"];
function dafToken(tok){          // (G_VAL: letter values, defined with isHebNum below)
  if(!tok || tok.length > 3) return 0;
  let prev = Infinity, sum = 0;
  for(const ch of tok){
    const v = G_VAL[ch];
    if(v == null || v > prev) return 0;
    prev = v; sum += v;
  }
  return sum >= 2 && sum <= 180 ? sum : 0;
}
// The daf in a page name Abba gave ("מכות ה.", "דף כד ע"ב"). Only when the name
// clearly says so (the word דף, ע"א/ע"ב, or a tractate followed by "ה." / "כד:"),
// so the first words of a page are never taken for a daf.
function dafFromName(name){
  const s = " " + String(name || "").replace(/[֑-ׇ]/g, "") + " ";
  const bound = (w) => new RegExp("(^|[^א-ת])" + w + "(?=[^א-ת]|$)");
  const mas = MASECHTOT.find(m => bound(m).test(s)) || "";
  const am = s.match(/(^|[^א-ת])ע\s*["'״׳]?\s*([אב])(?=[^א-ת]|$)/);
  const sure = bound("דף").test(s) || am || (mas && new RegExp(mas + "\\s+(דף\\s+)?[א-ת]{1,3}\\s*[.:׃]").test(s));
  if(!sure) return null;
  let t = s.replace(/(^|[^א-ת])ע\s*["'״׳]?\s*[אב](?=[^א-ת]|$)/g, "$1 ").replace(/עמוד\s*[אב]/g, " ");
  if(mas) t = t.replace(mas, " ");
  t = t.replace(/(^|[^א-ת])דף(?=[^א-ת]|$)/g, "$1 ").replace(/["'״׳]/g, "");
  const re = /[א-ת]+/g;
  let m;
  while((m = re.exec(t))){
    const n = dafToken(m[0]);
    if(!n) continue;
    let amud = am ? am[2] : "";
    if(!amud){
      const after = t.slice(m.index + m[0].length).match(/^\s*([.:׃])/);
      if(after) amud = after[1] === "." ? "א" : "ב";
    }
    return {daf:n, amud, masechet:mas};
  }
  return null;
}

/* -------------------------------------------------------------- constants */
const PAGE_SIZES = [
  {k:"170x240", w:170, h:240, label:"17×24", note:"ספר רגיל"},
  {k:"160x230", w:160, h:230, label:"16×23", note:"בינוני"},
  {k:"140x210", w:140, h:210, label:"14×21", note:"ספר קטן"},
  {k:"120x170", w:120, h:170, label:"12×17", note:"ספר כיס"},
  {k:"148x210", w:148, h:210, label:"A5", note:"חוברת"},
  {k:"210x297", w:210, h:297, label:"A4", note:"דף רגיל"},
  {k:"240x340", w:240, h:340, label:"24×34", note:"ספר גדול"},
];
// The bundled faces come from book_fonts.json (/book/fonts.json); this default
// is only for the first instant and for the offline build gate.
let FONT_FILES = [
  {key:"frank",  family:"BK Frank", weight:"300 900", ext:"ttf", fmt:"truetype", label:"פרנק־רוהל — הקלאסי של ספרי הקודש", role:"body"},
  {key:"david",  family:"BK David", weight:"400", ext:"ttf", fmt:"truetype", label:"דוד", role:"body"},
  {key:"davidb", family:"BK David", weight:"700", ext:"ttf", fmt:"truetype", label:"", role:""},
  {key:"rashi",  family:"BK Rashi", weight:"100 900", ext:"ttf", fmt:"truetype", label:"אותיות רש\"י", role:"notes"},
  {key:"suez",   family:"BK Suez",  weight:"400", ext:"ttf", fmt:"truetype", label:"סואץ — לכותרות", role:"heading"},
];
let USER_FONTS = [];                       // [{file, label, fmt}] — fonts the user added himself
let BUNDLED = [];
function rebuildFontLists(){
  BUNDLED = FONT_FILES.filter(f => f.label).map(f => ({v:"b:" + f.key, family:f.family, label:f.label, role:f.role}));
}
rebuildFontLists();
async function loadFontCatalog(){
  try{
    const r = await fetch("/book/fonts.json");
    const j = await r.json();
    if(j && Array.isArray(j.fonts) && j.fonts.length){ FONT_FILES = j.fonts; rebuildFontLists(); }
  }catch(e){}
  try{
    const r = await fetch("/api/book/userfonts", {headers:{"X-Mishkenotecha-Token": APP.token}});
    const j = await r.json();
    if(j && Array.isArray(j.fonts)) USER_FONTS = j.fonts;
  }catch(e){}
}
function userFamily(file){ return "UF " + String(file || "").replace(/\.[a-z]+$/i, ""); }
const SYSTEM_FONTS = [
  ["Guttman Vilna","וילנא — גוטמן"], ["Guttman Rashi","רש\"י — גוטמן"], ["Guttman Frank","פרנק — גוטמן"],
  ["Hadassah Friedlaender","הדסה — פרידלנדר"], ["Guttman Stam","סת\"ם — גוטמן"], ["Guttman Stam1","סת\"ם 1 — גוטמן"],
  ["Guttman Drogolin","דרוגולין — גוטמן"], ["Guttman Hatzvi","הצבי — גוטמן"], ["Guttman Yad","יד — גוטמן"],
  ["Guttman Mantova","מנטובה — גוטמן"], ["Guttman Keren","קרן — גוטמן"], ["Guttman Hodes","הודס — גוטמן"],
  ["Rod","רוד (דמוי רש\"י)"], ["Narkisim","נרקיסים"], ["Levenim MT","לבנים"],
  ["Vilna","וילנא"], ["Rashi","רש\"י"], ["FrankRuehl","פרנק־רוהל של Windows"],
  ["David","דוד של Windows"], ["Miriam","מרים"],
  ["Taamey Frank CLM","טעמי פרנק — לניקוד וטעמים"], ["Taamey David CLM","טעמי דוד"],
  ["Keter YG","כתר"], ["Ezra SIL","עזרא SIL"], ["SBL Hebrew","SBL Hebrew"], ["Shofar","שופר"],
  ["Times New Roman","Times New Roman"],
];
const KINDS = [
  ["chapter","פרק"], ["siman","סימן / סעיף"], ["intro","הקדמה"], ["haskama","הסכמה"],
  ["part","שער / חלק — עמוד נפרד"], ["text","טקסט בלי כותרת"],
];
const KIND_LABEL = {chapter:"פרק", siman:"סימן", intro:"הקדמה", haskama:"הסכמה", part:"שער", text:"טקסט"};
// the word THIS book uses for its parts (פרשת, דף, סימן, שאלה…), not always "פרק"/"סימן"
function kindName(kind){ return kind === "chapter" ? (st && st.chapterWord || "פרק") : kind === "siman" ? (st && st.simanWord || "סימן") : (KIND_LABEL[kind] || ""); }
// v1.8.83 (Abba 11-01: "שיחולו על הקטע השני הגדרות אחרות"): a look for ONE whole section — every paragraph
// in it is set this way, on top of the book's styles. The same looks as the word tags, so nothing new to learn.
const SEC_LOOKS = [["", "רגיל — כמו כל הספר"], ["k", "אותיות קטנות"], ["g", "אותיות גדולות"], ["r", "אותיות רש\"י"],
  ["m", "אותיות מרובעות"], ["quote", "❝ ציטוט מוזח (שוליים פנימה)"], ["a", "אפור"]];
const SEC_LOOK_CLS = {k:"bk-t-k", g:"bk-t-g", r:"bk-t-r", m:"bk-t-m", quote:"bk-quote", a:"bk-t-a"};
// v1.8.90 (Eli 11-02, the root: "התוכנה נבנתה מותאמת לעושה חיל"): one setting for the whole book fits only a
// book of one kind of paragraph. A book has NAMED paragraph styles — פסוק, פירוש, מפרש, שאלה, תשובה… — chosen
// for a paragraph by a click on the page; changing a style changes every paragraph that has it. A style's look
// is st.el["ps_<id>"] (edited in the styles tab like any element) over its built-in start.
const PS_START = {
  pasuk:{font:"b:taamey", size:105, weight:"bold", align:"center", noOpen:true, noDib:true},
  perush:{}, main:{size:110, weight:"bold"}, mefaresh:{font:"b:rashi", size:90},
  q:{weight:"bold"}, a:{}, quote:{indent:1.5, size:92, noOpen:true},
  small:{size:86}, center:{align:"center", noOpen:true}, bold:{weight:"bold"}, title2:{weight:"bold", align:"center", size:110, noOpen:true, noDib:true, keep:"next", before:0.4},
  box:{box:"frame", keep:"all", noOpen:true}, shade:{box:"shade", keep:"all", noOpen:true},
};
const PS_DEFAULT = [{id:"pasuk", name:"פסוק"}, {id:"perush", name:"פירוש"}, {id:"quote", name:"ציטוט"}, {id:"small", name:"קטן"},
  {id:"center", name:"במרכז"}, {id:"bold", name:"מודגש"}, {id:"box", name:"במסגרת"}, {id:"shade", name:"רקע אפור"}];
function psList(s){ return Array.isArray((s || st || {}).pstyles) && (s || st).pstyles.length ? (s || st).pstyles : PS_DEFAULT; }
function psLook(id, s){ s = s || st; return Object.assign({}, PS_START[id] || {}, ((s.el || {})["ps_" + id]) || {}); }
function psName(id){ const x = psList().find(p => p.id === id); return x ? x.name : id; }
const KIND_HINT = {chapter:"פרק — נדפס עם כותרת גדולה", siman:"סימן — נדפס עם כותרת קטנה", intro:"הקדמה — מתחילה בעמוד חדש",
  haskama:"הסכמה — מתחילה בעמוד חדש", part:"שער — עמוד נפרד", text:"טקסט בלי כותרת — נדפס בהמשך לטקסט שלפניו"};
const HEAD1 = ["פרק","חלק","שער","מאמר"];
const HEAD2 = ["סימן","סעיף","אות","ענף","הלכה","דרוש","פרשת","פרשה","משנה"];

const DEFAULT_STYLE = {
  template:"classic", pageSize:"170x240", pageW:170, pageH:240, margins:"normal",
  bodyFont:"b:frank", bodySize:12.5, lineHeight:1.55, columns:1, paraStyle:"gap",
  headFont:"b:frank", opener:"big",
  noteFont:"b:rashi", noteSize:9.5, noteCols:2, noteMarker:"num", notesNumbering:"chapter", noteDibur:false,
  noteFlow:"block",
  headerMode:"both", headerRule:true, pageNumbers:"hebrew", pageNumPos:"bottom", noHeaderOnChapter:true,
  chapterNewPage:true, autoNumber:true, chapterWord:"פרק", simanWord:"סימן",
  simanStyle:"center", numLabels:true, bodyDibur:false, emphSquare:false, titleFrame:"double",
  chapterLook:"plain", simanLook:"plain", chapterSpan:true, openerEvery:false, centerEvery:false, headerCenter:"siman",
  numSize:"big", entryGap:false, simanSpan:false, subCenter:false, digitHang:true,
  smartGeresh:true, keepAbbrev:true, itemLabels:true, openerAfterNum:false, diburLineJoin:true, diburOnItems:false, diburWhere:"", diburUntil:"auto", diburWords:3, diburNewLine:false, diburMarks:"", diburPasuk:false, pasukCenter:false,
  numFormat:"keep", openerWords:1, sectionSep:"none", endMark:"none", noteSep:"short", noteSepText:"הערות וביאורים",
  pnumFormat:"plain", colRule:"none", ornWidth:62, ornH:0, el:{},
  catchword:false, noLonelyWord:true, widows:true, centerLastLine:false, sourcesSmall:true,
  hideNikud:false, hideTeamim:false, cropMarks:false, titlePage:true, toc:"end", tocSimanim:"auto",
};
// what every template resets first, so switching templates never leaves a stray
// setting behind from the previous one
const TEMPLATE_BASE = {
  columns:1, paraStyle:"gap", opener:"big", noteFlow:"block", noteDibur:false, simanStyle:"center",
  numLabels:true, bodyDibur:false, emphSquare:false, headerRule:true, pageNumPos:"bottom", digitHang:true,
  centerLastLine:false, titleFrame:"double", simanWord:"סימן", headerMode:"both", headFont:"b:frank",
  chapterLook:"plain", simanLook:"plain", chapterSpan:true, openerEvery:false, centerEvery:false, headerCenter:"siman",
  autoNumber:true, chapterNewPage:true, chapterWord:"פרק", noteFlow:"block",
  numSize:"big", entryGap:false, simanSpan:false, subCenter:false, margins:"normal", noteFont:"b:rashi",
  diburWhere:"", diburUntil:"auto", diburNewLine:false, diburMarks:"", diburPasuk:false, pasukCenter:false, numFormat:"keep", openerWords:1, sectionSep:"none",
  endMark:"none", noteSep:"short", pnumFormat:"plain", colRule:"none",
};
// Each template follows a real, familiar sefer layout (studied in אוצר החכמה).
// group "daf": the family built on "שיעורים יומיים" (ממגד גרש ירחים, מכות) — חידושים על הדף.
const DAF_COMMON = {columns:2, bodyFont:"b:frank", bodySize:10, lineHeight:1.38, margins:"wide", paraStyle:"none",
  autoNumber:false, chapterNewPage:false, chapterWord:"דף", chapterSpan:false, chapterLook:"daf",
  opener:"window", openerEvery:true, centerEvery:true, bodyDibur:true, numLabels:true, numSize:"normal", entryGap:true,
  simanLook:"plain", simanSpan:true, subCenter:true, headerMode:"split", headerCenter:"chapter", headerRule:false,
  pageNumPos:"top", pageNumbers:"hebrew", noteFont:"b:frank", noteSize:8.5, noteCols:2, noteMarker:"num",
  notesNumbering:"page", noHeaderOnChapter:true, sourcesSmall:true, titleFrame:"double"};
const TEMPLATES = [
  {k:"daf", group:"daf", name:"שיעורים — קלאסי", desc:"כמו שיעורי רבי אבא ורבי אברהם יצחק: שני טורים צפופים, שם הספר מעל כל טור, הדף קטן אחרי ★ ☆ ★",
   set:Object.assign({}, DAF_COMMON)},
  {k:"dafRashi", group:"daf", name:"שיעורים — ביאור ברש\"י", desc:"כמו שיעורי רבי אהרן ורבי דוד ליפשיץ: הביאור באותיות רש\"י, הפתיחות והמספרים במרובע",
   set:Object.assign({}, DAF_COMMON, {bodyFont:"b:rashi", bodySize:10.5, lineHeight:1.36, emphSquare:true})},
  {k:"dafOrnate", group:"daf", name:"שיעורים — כותרת מעוטרת", desc:"כמו שיעורי רבי אליעזר מנשה: שם הספר באמצע בין קווים מעוטרים, הסימן מתחתיו",
   set:Object.assign({}, DAF_COMMON, {headerMode:"ornate", headerCenter:"siman", titleFrame:"ornate"})},
  {k:"dafSiman", group:"daf", name:"שיעורים — פתיחת סימן", desc:"כמו שיעורי רבי ברוך שמואל: \"סימן ה\" קטן, שם הנושא גדול, מרווח לבן לפני כל נושא",
   set:Object.assign({}, DAF_COMMON, {simanLook:"classic", autoNumber:true, simanWord:"סימן", headerCenter:"siman"})},
  {k:"dafOutline", group:"daf", name:"שיעורים — דף באותיות חלולות", desc:"כמו שיעורים יומיים (ממגד גרש ירחים): \"דף ב' ע\"ב\" באותיות חלולות בתוך הטור",
   set:Object.assign({}, DAF_COMMON, {chapterLook:"outline", bodySize:11, lineHeight:1.45})},
  {k:"daf1", group:"daf", name:"שיעורים — טור אחד", desc:"אותו סגנון בטור אחד, לספר קטן או לקונטרס",
   set:Object.assign({}, DAF_COMMON, {columns:1, bodySize:11.5, lineHeight:1.45, simanSpan:false, pageSize:"140x210", pageW:140, pageH:210})},
  {k:"classic", group:"more", name:"ספר עיון קלאסי", desc:"טור אחד, הערות באותיות רש\"י בשני טורים מתחת לקו",
   set:{bodyFont:"b:frank", bodySize:12.5, lineHeight:1.55, noteFont:"b:rashi", noteSize:9.5, noteCols:2,
        noteMarker:"num", pageNumbers:"hebrew", notesNumbering:"chapter"}},
  {k:"halacha", group:"more", name:"הלכה מבוארת", desc:"בסגנון \"שמירת שבת כהלכתה\": סעיפים ממוספרים, כותרות בשוליים, הערות רצופות",
   set:{bodyFont:"b:frank", bodySize:13, lineHeight:1.62, noteFont:"b:frank", noteSize:9.5, noteCols:1,
        noteFlow:"runin", noteMarker:"paren", notesNumbering:"chapter", opener:"none", paraStyle:"indent",
        headerRule:false, pageNumPos:"top", pageNumbers:"hebrew", numLabels:true, titleFrame:"none"}},
  {k:"old", group:"more", name:"חידושים בסגנון הישן", desc:"בסגנון \"דברי שמואל\": אותיות רש\"י בשני טורים, דיבור המתחיל מרובע",
   set:{bodyFont:"b:rashi", bodySize:12, lineHeight:1.45, columns:2, emphSquare:true, bodyDibur:true,
        simanStyle:"inline", headerMode:"split", headerRule:false, pageNumPos:"top", centerLastLine:true,
        opener:"none", noteFont:"b:rashi", noteSize:9, noteCols:2, noteMarker:"paren", pageNumbers:"hebrew",
        notesNumbering:"siman", titleFrame:"ornate"}},
  {k:"shulchan", group:"more", name:"טקסט ופירוש", desc:"בנוסח שולחן ערוך עם משנה ברורה — הפירוש למטה באותיות רש\"י",
   set:{bodyFont:"b:frank", bodySize:13.5, lineHeight:1.5, noteFont:"b:rashi", noteSize:10, noteCols:2,
        noteMarker:"paren", noteDibur:true, opener:"drop", pageNumbers:"hebrew", notesNumbering:"siman"}},
  {k:"twocol", group:"more", name:"שני טורים", desc:"הטקסט בשני טורים — כמו ספרי הלכה",
   set:{columns:2, bodyFont:"b:frank", bodySize:11.5, lineHeight:1.5, noteFont:"b:rashi", noteSize:9, noteCols:2,
        noteMarker:"letters", opener:"bold", pageNumbers:"hebrew", notesNumbering:"chapter"}},
  {k:"modern", group:"more", name:"מודרני ומאוורר", desc:"אות דוד, ריווח נדיב, הערות בטור אחד",
   set:{bodyFont:"b:david", bodySize:12.5, lineHeight:1.7, noteFont:"b:david", noteSize:9.5, noteCols:1,
        noteMarker:"num", opener:"bold", headerMode:"chapter", pageNumbers:"digits", paraStyle:"indent",
        notesNumbering:"book", headFont:"b:suez", titleFrame:"none"}},
  {k:"kuntres", group:"more", name:"קונטרס / חוברת", desc:"גודל 14×21 — נוח להדפסה ולחלוקה",
   set:{pageSize:"140x210", pageW:140, pageH:210, bodyFont:"b:frank", bodySize:11.5, lineHeight:1.5,
        noteFont:"b:rashi", noteSize:8.8, noteCols:1, noteMarker:"num", pageNumbers:"hebrew", notesNumbering:"book"}},
];

/* ----------------------------------------------------------------- fonts */
function fontFamily(v){
  v = String(v || "b:frank");
  if(v.startsWith("b:")){
    const f = FONT_FILES.find(x => x.key === v.slice(2)) || FONT_FILES[0];
    return "\"" + f.family + "\"";
  }
  if(v.startsWith("u:")) return "\"" + userFamily(v.slice(2)) + "\"";
  return "\"" + v.slice(2).replace(/["\\]/g, "") + "\"";
}
function fontStack(v){ return fontFamily(v) + ", \"BK Frank\", \"Frank Ruhl Libre\", \"David\", serif"; }
let detectedFonts = null;
function detectSystemFonts(){
  if(detectedFonts) return detectedFonts;
  detectedFonts = [];
  try{
    const c = document.createElement("canvas").getContext("2d");
    const sample = "אבגדהוזחטיכלמנסעפצקרשת שלום abcdefg 0123";
    const base = {};
    for(const fb of ["monospace","serif","sans-serif"]){ c.font = "40px " + fb; base[fb] = c.measureText(sample).width; }
    for(const [name, label] of SYSTEM_FONTS){
      let found = false;
      for(const fb of ["monospace","serif","sans-serif"]){
        c.font = "40px \"" + name + "\", " + fb;
        if(Math.abs(c.measureText(sample).width - base[fb]) > 0.5){ found = true; break; }
      }
      if(found && !detectedFonts.some(x => x.v === "s:" + name)) detectedFonts.push({v:"s:" + name, label: label + " — מותקן במחשב"});
    }
  }catch(e){}
  return detectedFonts;
}
function fontOptions(selected, inheritLabel){
  const opts = (inheritLabel ? [["", inheritLabel]] : [])
    .concat(BUNDLED.map(b => [b.v, b.label]))
    .concat(USER_FONTS.map(f => ["u:" + f.file, f.label + " — גופן שהוספת"]))
    .concat(detectSystemFonts().map(f => [f.v, f.label]));
  if(selected && !opts.some(o => o[0] === selected)) opts.push([selected, selected.slice(2) + " (לא נמצא במחשב)"]);
  return opts.map(([v, l]) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(l)}</option>`).join("");
}
function usedFonts(st){
  const out = [st.bodyFont, st.noteFont, st.headFont];
  if(st.tp && Array.isArray(st.tp.lines)) out.push(st.tp.font, ...st.tp.lines.map(L => L.font));
  if(st.tp && Array.isArray(st.tp.items)) out.push(...st.tp.items.map(it => it.font));
  for(const k in (st.el || {})) if(st.el[k] && st.el[k].font) out.push(st.el[k].font);
  return out.filter(Boolean);
}
async function fontsReady(st){
  const fams = new Set(["BK Frank", "BK Rashi"]);
  for(const v of usedFonts(st)){
    if(String(v).startsWith("b:") || String(v).startsWith("u:")) fams.add(fontFamily(v).replace(/"/g, ""));
  }
  const jobs = [];
  for(const f of fams){
    jobs.push(document.fonts.load("16px \"" + f + "\"", "אבג"));
    jobs.push(document.fonts.load("bold 16px \"" + f + "\"", "אבג"));
  }
  try{ await Promise.all(jobs); }catch(e){}
  try{ await document.fonts.ready; }catch(e){}
}

/* -------------------------------------------------------------- geometry */
function pageDims(st){
  const p = PAGE_SIZES.find(x => x.k === st.pageSize);
  if(p) return {W:p.w, H:p.h};
  const W = Math.min(420, Math.max(80, Number(st.pageW) || 170));
  const H = Math.min(600, Math.max(100, Number(st.pageH) || 240));
  return {W, H};
}
function geometry(st, side){
  const {W, H} = pageDims(st);
  const fx = W / 170, fy = H / 240;
  const m = {narrow:0.78, normal:1, wide:1.22}[st.margins] || 1;
  const r = (x) => Math.round(x * 10) / 10;
  const sw = side ? r(24 * fx) : 0;   // the margin-heading column, always on the right as in the books
  return {W, H, mt:r(20 * fy * m + 2), mb:r(19 * fy * m + 2), mi:r(19 * fx * m), mo:r(14.5 * fx * m), sw};
}

/* ------------------------------------------------------------- page CSS */
function pageCSS(st, fontBase, opts){
  const g = geometry(st, !!(opts && opts.side));
  const lh = Number(st.lineHeight) || 1.55;
  const nlh = Math.max(1.3, lh - 0.12);
  const fx = g.W / 170;
  const drop = (lh * 1.72).toFixed(2);
  const titlePt = Math.round(30 * fx);
  let css = "";
  for(const f of FONT_FILES){
    css += `@font-face{font-family:"${f.family}";src:url("${fontBase}${f.key}.${f.ext || "ttf"}") format("${f.fmt || "truetype"}");font-weight:${f.weight};font-style:normal;font-display:block}\n`;
  }
  const ub = (opts && opts.userBase) || (fontBase === "fonts/" ? "fonts/user/" : "/book/userfont/");
  for(const f of USER_FONTS){
    css += `@font-face{font-family:"${userFamily(f.file)}";src:url("${ub}${f.file}") format("${f.fmt || "truetype"}");font-style:normal;font-display:block}\n`;
  }
  css += `
.bk-page{position:relative;width:${g.W}mm;height:${g.H}mm;background:#fff;overflow:hidden;direction:rtl;color:#000;text-align:right;
 font-family:${fontStack(st.bodyFont)};font-size:${st.bodySize}pt;line-height:${lh};font-kerning:normal;
 font-variant-ligatures:common-ligatures;font-weight:400}
.bk-page *{box-sizing:border-box}
.bk-body{position:absolute;top:${g.mt}mm;bottom:${g.mb}mm;display:flex;flex-direction:column}
.bk-page.odd .bk-body,.bk-page.odd .bk-head,.bk-page.odd .bk-foot{right:${g.mi + g.sw}mm;left:${g.mo}mm}
.bk-page.even .bk-body,.bk-page.even .bk-head,.bk-page.even .bk-foot{right:${g.mo + g.sw}mm;left:${g.mi}mm}
.bk-head{position:absolute;bottom:${(g.H - g.mt + 2.6).toFixed(1)}mm;min-height:4.5mm;display:flex;align-items:flex-end;gap:3mm;${st.bodyFont === "b:rashi" ? "font-family:" + fontStack("b:frank") + ";" : ""}
 font-size:.8em;line-height:1.2;padding-bottom:1.2mm;${st.headerRule ? "border-bottom:.5pt solid #000;" : ""}}
.bk-head.off{visibility:hidden}
.bk-head span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bk-head .bk-hc{flex:4;text-align:center;font-weight:700}
.bk-head .bk-hr{text-align:right}
.bk-head .bk-hl{text-align:left}
.bk-head .bk-pn{font-weight:700}
.bk-foot{position:absolute;bottom:${Math.max(3, g.mb - 11)}mm;height:6mm;text-align:center;font-size:.86em;line-height:1}
.bk-foot .bk-pn{font-weight:700}
.bk-catch{position:absolute;left:0;bottom:0;font-size:.9em}
.bk-flow{flex:none;display:flow-root}
.bk-flow.c2{column-count:2;column-gap:${(6 * fx).toFixed(1)}mm;column-fill:balance}
.bk-p{margin:0 0 ${st.paraStyle === "gap" ? ".3em" : "0"};text-align:justify;text-indent:${st.paraStyle === "indent" ? "1.4em" : "0"};
 hyphens:none;orphans:1;widows:1;overflow-wrap:break-word}
.bk-p.bk-cont,.bk-p.bk-ctop{text-indent:0}
${st.paraStyle === "hang" ? `.bk-p:not(.bk-center):not(.bk-quote):not(.bk-li):not(.bk-hang){padding-right:1.4em;text-indent:-1.4em}.bk-p.bk-cont:not(.bk-center):not(.bk-quote):not(.bk-li):not(.bk-hang){text-indent:0}` : ""}
.bk-p.bk-split{text-align-last:justify}
.bk-p.bk-lastc{text-align-last:center}
.bk-p.bk-center{text-align:center;text-align-last:center;text-indent:0}
.bk-open{font-weight:700;text-indent:0}
.bk-p.bk-p:has(> .bk-open.window),.bk-p.bk-p:has(> .bk-open.drop){padding-right:0!important;text-indent:0!important}
.bk-open.big{font-size:1.2em;line-height:0}
.bk-open.letter{font-size:1.75em;line-height:.8;font-weight:700}
.bk-open.drop{float:right;font-size:${drop}em;line-height:1;margin:.05em 0 0 .16em}
.bk-open.window{float:right;font-size:1.18em;line-height:1.1;position:relative;top:${WIN_SHIFT}em;height:${((2 * lh - 0.35) / 1.18).toFixed(3)}em;margin-left:.2em}
.bk-src{font-size:.84em}
.bk-mk{font-size:.62em;line-height:0;vertical-align:.62em;font-weight:700;padding:0 .05em}
.bk-mk.paren{font-size:.74em;vertical-align:.34em}
.bk-h1{text-align:center;margin:0 0 .9em;break-inside:avoid;${st.chapterSpan === false ? "" : "column-span:all;"}font-family:${fontStack(st.headFont)}}
.bk-flow>.bk-h1.np:first-child{padding-top:${(9 * g.H / 240).toFixed(1)}mm}
.bk-h1:not(.np){margin-top:.5em}
.bk-flow>.bk-h1:not(.np):first-child{margin-top:0}
.bk-h1.lk-outline .bk-hlabel,.bk-h1.lk-outline .bk-htitle{color:#fff;-webkit-text-stroke:.75pt #000}
.bk-h1.lk-outline .bk-hlabel{font-size:2.2em;font-weight:800}
.bk-h1.lk-ornament .bk-hlabel::before{content:"❖ ";font-size:.6em;vertical-align:.25em}
.bk-h1.lk-ornament .bk-hlabel::after{content:" ❖";font-size:.6em;vertical-align:.25em}
.bk-h1.lk-ornament .bk-hlabel{letter-spacing:.04em}
.bk-h1.lk-banner .bk-hlabel{background:#000;color:#fff;padding:.5mm 0 1mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bk-h1.lk-lines .bk-hlabel{display:flex;align-items:center;gap:.45em}
.bk-h1.lk-lines .bk-hlabel::before,.bk-h1.lk-lines .bk-hlabel::after{content:"";flex:1;border-top:.7pt solid #000}
.bk-h1.lk-frame{display:table;margin-left:auto;margin-right:auto;padding:1.4mm 6mm 1.8mm;border:.8pt solid #000;outline:.4pt solid #000;outline-offset:1mm}
.bk-flow>.bk-h1.lk-frame:not(:first-child){margin-top:.9em}
.bk-h2.span{column-span:all;margin:.8em 0 .45em}
.bk-h1.span{column-span:all}
.bk-h1.span+.bk-h2.span{margin-top:.2em}
.bk-flow>.bk-h2.span:first-child{margin-top:0}
.bk-h1.lk-daf{margin:.9em 0 .35em}
.bk-h1.lk-daf .bk-hlabel{font-size:1.06em;font-weight:700}
.bk-h1.lk-daf::before{content:"★ ☆ ★";display:block;font-size:.62em;letter-spacing:.35em;margin-bottom:.55em}
.bk-flow>.bk-h1.lk-daf:first-child::before{display:none}
.bk-flow>.bk-h1.lk-daf:first-child{margin-top:0}
.bk-h2.sl-classic .bk-hlabel{font-size:.86em;font-weight:400;letter-spacing:.03em}
.bk-h2.sl-classic .bk-htitle{font-size:1.42em;font-weight:500;line-height:1.3;margin-top:.15em}
.bk-h2.sl-classic{margin:1.6em 0 .8em}
.bk-flow>.bk-h2.sl-classic:first-child{margin-top:.4em}
.bk-h2.sl-underline::after{content:"";display:block;width:26%;margin:.22em auto 0;border-top:.6pt solid #000}
.bk-h2.sl-lines .bk-hlabel,.bk-h2.sl-lines .bk-htitle:only-child{display:flex;align-items:center;gap:.4em}
.bk-h2.sl-lines .bk-hlabel::before,.bk-h2.sl-lines .bk-hlabel::after{content:"";flex:1;border-top:.5pt solid #000}
.bk-h1 .bk-hlabel{display:block;font-size:1.85em;font-weight:700;line-height:1.15}
.bk-h1 .bk-htitle{display:block;font-size:1.3em;font-weight:700;line-height:1.25;margin-top:.12em}
.bk-h1 .bk-horn{display:block;font-size:.8em;letter-spacing:.55em;margin-top:.3em}
.bk-h2{text-align:center;margin:.6em 0 .3em;break-inside:avoid;font-family:${fontStack(st.headFont)}}
.bk-flow>.bk-h2:first-child{margin-top:0}
.bk-h2 .bk-hlabel{display:block;font-size:1.22em;font-weight:700;line-height:1.2}
.bk-h2 .bk-htitle{display:block;font-size:1.04em;font-weight:700;line-height:1.3}
.bk-h3{font-weight:700;margin:.45em 0 .12em;font-size:1.04em;break-inside:avoid}
.bk-h3.sc{text-align:center;font-size:.88em;font-weight:600;margin:.7em 0 .2em}
.bk-flow>.bk-h3:first-child{margin-top:0}
.bk-hdaf{text-align:center;line-height:1.25;margin:.75em 0 .3em;break-inside:avoid;font-family:${fontStack(st.headFont)}}
.bk-hdaf .t{font-weight:700;font-size:1.02em}
.bk-flow>.bk-hdaf:first-child{margin-top:0}
.bk-hdaf.lk-star{margin:.9em 0 .35em}
.bk-hdaf.lk-star .t{font-size:1.06em}
.bk-hdaf.lk-star::before{content:"★ ☆ ★";display:block;font-size:.62em;font-weight:400;letter-spacing:.35em;margin-bottom:.55em}
.bk-flow>.bk-hdaf.lk-star:first-child::before{display:none}
.bk-hdaf.lk-outline{line-height:1.12;margin:.6em 0 .25em}
.bk-hdaf.lk-outline .t{font-size:1.9em;font-weight:800;color:#fff;-webkit-text-stroke:.7pt #000}
.bk-hdaf.lk-ornate{display:flex;align-items:center;gap:.3em}
.bk-hdaf.lk-ornate::before,.bk-hdaf.lk-ornate::after{content:"";flex:1;border-top:.6pt solid #000}
.bk-hdaf.lk-ornate .t{flex:none;font-size:1.1em}
.bk-hdaf.lk-ornate .t::before{content:"◆\\00a0";font-size:.7em;vertical-align:.12em}
.bk-hdaf.lk-ornate .t::after{content:"\\00a0◆";font-size:.7em;vertical-align:.12em}
.bk-hdaf.lk-square .t{font-family:${fontStack("b:frank")};font-size:1.12em;letter-spacing:.04em}
.bk-hdaf.lk-siman{margin:1.6em 0 .5em}
.bk-flow>.bk-hdaf.lk-siman:first-child{margin-top:.4em}
.bk-hdaf.lk-siman .t{font-size:.88em;font-weight:400;letter-spacing:.03em}
.bk-hdaf.lk-orn::before{content:"❖";margin-left:.45em;font-size:.85em}
.bk-hdaf.lk-orn::after{content:"❖";margin-right:.45em;font-size:.85em}
.bk-hdaf.lk-lines{display:flex;align-items:center;gap:.45em}
.bk-hdaf.lk-lines::before,.bk-hdaf.lk-lines::after{content:"";flex:1;border-top:.6pt solid #000}
.bk-hdaf.lk-lines .t{flex:none}
.bk-hdaf.lk-frame{display:table;margin-left:auto;margin-right:auto;padding:.5mm 4mm .8mm;border:.6pt solid #000}
.bk-hdaf.lk-banner{background:#000;color:#fff;padding:.35mm 0 .65mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bk-hdaf.span{column-span:all}
.bk-sep{text-align:center;margin:.25em 0 .35em;letter-spacing:.8em;font-size:.85em;break-inside:avoid}
.bk-ornsep{break-after:avoid;break-after:avoid-column;page-break-after:avoid}
.bk-notes{flex:none;margin-top:auto;position:relative;padding-top:2.8mm;font-family:${fontStack(st.noteFont)};
 font-size:${st.noteSize}pt;line-height:${nlh}}
.bk-notes::before{content:"";position:absolute;top:1.2mm;right:0;width:30%;border-top:.5pt solid #000}
.bk-notes.off{display:none}
.bk-notes-a,.bk-notes-b{column-count:${st.noteCols};column-gap:5mm;column-fill:balance}
.bk-notes-b{margin-top:1.3mm;padding-top:1.1mm;border-top:.3pt solid #888}
.bk-notes-a:empty,.bk-notes-b:empty{display:none}
.bk-notes-a:empty+.bk-notes-b{margin-top:0;padding-top:0;border-top:none}
.bk-note{margin:0 0 .08em;text-align:justify}
.bk-note.bk-split{text-align-last:justify}
.bk-nl{font-weight:700;margin-left:.3em}
.bk-dib{font-weight:700}
.bk-tp{position:absolute;top:${g.mt}mm;bottom:${g.mb}mm;left:${g.mo}mm;right:${g.mi}mm;display:flex;flex-direction:column;
 align-items:center;text-align:center;padding:14mm 9mm 10mm;font-family:${fontStack(st.headFont)}}
.bk-tp-pre{font-size:1.05em;letter-spacing:.3em;margin-top:6mm}
.bk-tp-title{font-size:${titlePt}pt;font-weight:800;line-height:1.15;margin-top:4mm}
.bk-tp-sub{font-size:1.15em;margin-top:5mm;line-height:1.5;white-space:pre-line}
.bk-tp-orn{margin:9mm 0;font-size:1.1em;letter-spacing:.7em}
.bk-tp-auth{font-size:1.3em;font-weight:700;line-height:1.55;white-space:pre-line}
.bk-tp-place{margin-top:auto;font-size:1.05em;line-height:1.5;white-space:pre-line}
.bk-back{position:absolute;top:${g.mt}mm;bottom:${g.mb}mm;left:${g.mi}mm;right:${g.mo}mm;display:flex;flex-direction:column;align-items:center;text-align:center}
.bk-ded{margin:auto 0;border:1pt solid #000;padding:6mm 9mm;font-size:1.1em;line-height:1.75;white-space:pre-line;font-weight:700;max-width:100%}
.bk-copy{margin-top:auto;font-size:.8em;line-height:1.6;white-space:pre-line}
.bk-ded+.bk-copy{margin-top:0}
.bk-part{position:absolute;top:${g.mt}mm;bottom:${g.mb}mm;left:${g.mo}mm;right:${g.mi}mm;display:flex;align-items:center;
 justify-content:center;flex-direction:column;text-align:center;font-family:${fontStack(st.headFont)}}
.bk-part .t{font-size:2.5em;font-weight:800;line-height:1.25}
.bk-part .o{margin-top:7mm;letter-spacing:.7em}
.bk-toc{display:flex;align-items:baseline;gap:.35em;margin:0 0 .16em;break-inside:avoid}
.bk-p{position:relative}
.bk-sideh{position:absolute;top:.25em;left:calc(100% + 3mm);right:auto;width:${Math.max(8, g.sw - 4)}mm;font-size:.68em;line-height:1.3;
 font-weight:700;text-align:center;text-align-last:center;text-indent:0;white-space:normal}
.bk-sideh.bk-sidein{position:static;display:inline;width:auto;font-size:.9em;line-height:inherit;margin-left:.2em}
.bk-num{font-weight:800;${st.numSize === "normal" ? "" : "font-size:1.32em;line-height:.9;"}margin-left:.12em}
.bk-p.bk-entry{margin-top:.75em}
.bk-flow>.bk-p.bk-entry:first-child,.bk-h1+.bk-p.bk-entry,.bk-h2+.bk-p.bk-entry,.bk-h3+.bk-p.bk-entry,.bk-hdaf+.bk-p.bk-entry,.bk-mark+.bk-p.bk-entry{margin-top:0}
.bk-p.bk-li{padding-right:2.1em;text-indent:0}
.bk-p.bk-ind1{margin-right:1.6em}.bk-p.bk-ind2{margin-right:3.2em}.bk-p.bk-ind3{margin-right:4.8em}.bk-p.bk-ind4{margin-right:6.4em}
.bk-p.bk-hang{padding-right:1.4em;text-indent:-1.4em}
.bk-p.bk-hang.bk-ctop{text-indent:-1.4em}
.bk-p.bk-hang.bk-cont{text-indent:0}
.bk-dlead,.bk-p.bk-hang .bk-num{font-weight:700}
.bk-ilabel{margin-left:.15em}
.bk-runin{font-weight:700}
.bk-p.bk-runp{margin-top:.55em}
.bk-flow>.bk-mark+.bk-p.bk-runp,.bk-flow>.bk-p.bk-runp:first-child{margin-top:0}
.bk-mark{height:0;margin:0;overflow:hidden}
.bk-p .bk-dib{font-weight:700}
${st.emphSquare ? `.bk-p b,.bk-p .bk-dib,.bk-open,.bk-runin,.bk-num,.bk-ilabel,.bk-h2,.bk-h3{font-family:${fontStack(st.headFont && st.headFont !== "b:rashi" ? st.headFont : "b:frank")}}` : ""}
.bk-nrun{margin:0;text-align:justify}
.bk-nrun.bk-split{text-align-last:justify}
.bk-nrun .bk-note{display:inline;margin:0}
.bk-head.split{align-items:flex-end}
.bk-head.split .bk-hr,.bk-head.split .bk-hl{flex:1;font-size:1.3em;font-weight:700;line-height:1.1;letter-spacing:.02em;
 font-family:${fontStack(st.headFont && st.headFont !== "b:rashi" ? st.headFont : "b:frank")};text-align:${Number(st.columns) === 2 ? "center" : "right"}}
.bk-head.split .bk-hl{text-align:${Number(st.columns) === 2 ? "center" : "left"}}
.bk-head.split .bk-hc{flex:none;position:absolute;left:50%;transform:translateX(-50%);bottom:1.4mm;font-weight:400;font-size:.82em;white-space:nowrap}
.bk-pnc{position:absolute;bottom:1.4mm;font-size:.9em;font-weight:700}
.bk-page.odd .bk-pnc{left:0}
.bk-page.even .bk-pnc{right:0}
${Number(st.columns) === 2 ? "" : ".bk-page.odd .bk-head.split .bk-hl{padding-left:2.4em}.bk-page.even .bk-head.split .bk-hr{padding-right:2.4em}"}
.bk-head.ornate .bk-hr,.bk-head.ornate .bk-hl{flex:0 0 2.4em}
.bk-head.ornate .bk-hc{flex:1;display:flex;flex-direction:column;align-items:center;font-weight:400}
.bk-head.ornate .ot{display:flex;align-items:center;gap:.35em;width:100%;font-size:1.25em;line-height:1.2}
.bk-head.ornate .ot i{flex:1;border-top:.6pt solid #000}
.bk-head.ornate .ot b{padding:0 .15em}
.bk-head.ornate .os{font-size:.82em;margin-top:.4mm}
.bk-head.ornate .bk-pnc{bottom:auto;top:0;font-size:1.05em}
${st.chapterLook === "outline" ? ".bk-head.split .bk-hr,.bk-head.split .bk-hl{color:#fff;-webkit-text-stroke:.55pt #000}.bk-head.split .bk-pn2{color:#000;-webkit-text-stroke:0}" : ""}
.bk-pn2{font-size:.72em;font-weight:700;margin:0 1em;vertical-align:.08em}
.bk-tp.f-none{border:none}
.bk-tp.f-double,.bk-tp.f-ornate{border:.6pt solid #000;outline:2.2pt solid #000;outline-offset:1.7mm}
.bk-tp .bk-c{position:absolute;font-style:normal;font-size:13pt;line-height:1;background:#fff;padding:.4mm .9mm;
 -webkit-print-color-adjust:exact;print-color-adjust:exact}
.bk-tp .c1{top:-3.6mm;right:-3.9mm}.bk-tp .c2{top:-3.6mm;left:-3.9mm}.bk-tp .c3{bottom:-3.6mm;right:-3.9mm}.bk-tp .c4{bottom:-3.6mm;left:-3.9mm}
.bk-tp .c5{top:-3.1mm;left:50%;transform:translateX(-50%);font-size:9pt;letter-spacing:.35em;padding:.4mm 2mm}
.bk-tp .c6{bottom:-3.1mm;left:50%;transform:translateX(-50%);font-size:9pt;letter-spacing:.35em;padding:.4mm 2mm}
.bk-tp-orn{display:flex;align-items:center;justify-content:center;gap:2.5mm;margin:0;width:46%;font-size:.95em;letter-spacing:0;line-height:1.2}
.bk-tp-orn i{flex:1;border-top:.6pt solid #000}
.bk-tp-orn i.d{border-bottom:.6pt solid #000;height:1.2mm}
.bk-tp-orn.o-stars,.bk-tp-orn.o-diam,.bk-tp-orn.o-dots,.bk-tp-orn.o-leaf{letter-spacing:.35em}
.bk-tpx{line-height:1.3;white-space:pre-line;max-width:100%}
.bk-tpx.k-title{line-height:1.15}
.bk-tpx.hollow{color:#fff;-webkit-text-stroke:.7pt #000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bk-tp.f-single{border:.6pt solid #000}
.bk-tp.f-thick{border:2.4pt solid #000;outline:.6pt solid #000;outline-offset:-2.6mm}
.bk-tp.f-dashed{border:1pt dashed #000}
.bk-tp.f-round{border:1pt solid #000;border-radius:7mm;outline:.6pt solid #000;outline-offset:1.5mm}
.bk-tp.f-arch{border:1pt solid #000;border-radius:48% 48% 2mm 2mm / 20mm 20mm 2mm 2mm;outline:.6pt solid #000;outline-offset:1.5mm}
.bk-tp.f-corners{border:none}
.bk-tp.f-portal,.bk-tp.f-portalarch{border:none;padding-left:21%;padding-right:21%}
.bk-tp.f-portal{padding-top:22mm}
.bk-tp.f-portalarch{padding-top:30mm}
.bk-tpart{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.bk-tp.f-chain,.bk-tp.f-beads{border:5mm solid transparent;border-image-slice:30;border-image-repeat:round;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bk-tp.f-chain{border-image-source:url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2290%22%20height%3D%2290%22%20viewBox%3D%220%200%2090%2090%22%3E%3Cpath%20d%3D%22M0%2C15%20H90%20M0%2C75%20H90%20M15%2C0%20V90%20M75%2C0%20V90%22%20stroke%3D%22%23000%22%20stroke-width%3D%222.4%22%20fill%3D%22none%22%2F%3E%3Cg%20fill%3D%22%23000%22%3E%3Cpath%20d%3D%22M15%2C4%20L26%2C15%20L15%2C26%20L4%2C15%20Z%22%2F%3E%3Cpath%20d%3D%22M15%2C34%20L26%2C45%20L15%2C56%20L4%2C45%20Z%22%2F%3E%3Cpath%20d%3D%22M15%2C64%20L26%2C75%20L15%2C86%20L4%2C75%20Z%22%2F%3E%3Cpath%20d%3D%22M45%2C4%20L56%2C15%20L45%2C26%20L34%2C15%20Z%22%2F%3E%3Cpath%20d%3D%22M45%2C64%20L56%2C75%20L45%2C86%20L34%2C75%20Z%22%2F%3E%3Cpath%20d%3D%22M75%2C4%20L86%2C15%20L75%2C26%20L64%2C15%20Z%22%2F%3E%3Cpath%20d%3D%22M75%2C34%20L86%2C45%20L75%2C56%20L64%2C45%20Z%22%2F%3E%3Cpath%20d%3D%22M75%2C64%20L86%2C75%20L75%2C86%20L64%2C75%20Z%22%2F%3E%3C%2Fg%3E%3Cg%20fill%3D%22%23fff%22%3E%3Cpath%20d%3D%22M15%2C11%20L19%2C15%20L15%2C19%20L11%2C15%20Z%22%2F%3E%3Cpath%20d%3D%22M15%2C41%20L19%2C45%20L15%2C49%20L11%2C45%20Z%22%2F%3E%3Cpath%20d%3D%22M15%2C71%20L19%2C75%20L15%2C79%20L11%2C75%20Z%22%2F%3E%3Cpath%20d%3D%22M45%2C11%20L49%2C15%20L45%2C19%20L41%2C15%20Z%22%2F%3E%3Cpath%20d%3D%22M45%2C71%20L49%2C75%20L45%2C79%20L41%2C75%20Z%22%2F%3E%3Cpath%20d%3D%22M75%2C11%20L79%2C15%20L75%2C19%20L71%2C15%20Z%22%2F%3E%3Cpath%20d%3D%22M75%2C41%20L79%2C45%20L75%2C49%20L71%2C45%20Z%22%2F%3E%3Cpath%20d%3D%22M75%2C71%20L79%2C75%20L75%2C79%20L71%2C75%20Z%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E")}
.bk-tp.f-beads{border-image-source:url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2290%22%20height%3D%2290%22%20viewBox%3D%220%200%2090%2090%22%3E%3Cpath%20d%3D%22M0%2C15%20H90%20M0%2C75%20H90%20M15%2C0%20V90%20M75%2C0%20V90%22%20stroke%3D%22%23000%22%20stroke-width%3D%222.4%22%20fill%3D%22none%22%2F%3E%3Cg%20fill%3D%22%23000%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%228.5%22%2F%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2245%22%20r%3D%228.5%22%2F%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2275%22%20r%3D%228.5%22%2F%3E%3Ccircle%20cx%3D%2245%22%20cy%3D%2215%22%20r%3D%228.5%22%2F%3E%3Ccircle%20cx%3D%2245%22%20cy%3D%2275%22%20r%3D%228.5%22%2F%3E%3Ccircle%20cx%3D%2275%22%20cy%3D%2215%22%20r%3D%228.5%22%2F%3E%3Ccircle%20cx%3D%2275%22%20cy%3D%2245%22%20r%3D%228.5%22%2F%3E%3Ccircle%20cx%3D%2275%22%20cy%3D%2275%22%20r%3D%228.5%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E")}
.bk-tpfree{position:absolute;inset:0;direction:ltr}
.bk-tpi{position:absolute;box-sizing:border-box;margin:0}
.bk-tpi.txt{display:flex;align-items:center;direction:rtl;white-space:pre-wrap;overflow:visible}
.bk-tpi.txt>span{display:block;width:100%}
.bk-tpi.line{display:flex;align-items:center}
.bk-tpi.line i{flex:1}
.bk-tpi.img{display:block}
.bk-tpi.svg,.bk-tpi.arc{display:block;overflow:visible}
.bk-tpi,.bk-tpfree{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bk-toc .t{flex:0 1 auto}
.bk-toc a.bk-tocl{display:contents;color:inherit;text-decoration:none}
.bk-toc .d{flex:1 1 1em;border-bottom:1.1pt dotted #444;min-width:1.2em;position:relative;top:-.28em}
.bk-toc .n{flex:none;min-width:2.1em;text-align:left;font-weight:700}
.bk-toc.l0{font-weight:800;margin-top:.55em}
.bk-toc.l1{font-weight:700;margin-top:.2em}
.bk-toc.l2{padding-right:1.4em;font-size:.95em}
`;
  css += `
.bk-t-k{font-size:.84em}
.bk-t-g{font-size:1.2em}
.bk-t-r{font-family:${fontStack("b:rashi")}}
.bk-t-m{font-family:${fontStack(st.headFont && st.headFont !== "b:rashi" ? st.headFont : "b:frank")}}
.bk-t-u{text-decoration:underline;text-underline-offset:.18em}
.bk-t-v{letter-spacing:.2em}
.bk-t-a{color:#555}
.bk-t-p{font-weight:700}
.bk-t-q{letter-spacing:.06em}
.bk-t-L{font-size:1.22em}
.bk-t-S{font-size:.84em}
.bk-p.bk-quote{margin-right:1.6em;margin-left:1.6em;font-size:.95em;text-indent:0}
.bk-colbreak{break-after:column;height:0;margin:0}
.bk-p.bk-al-r{text-align:right;text-align-last:right}
.bk-p.bk-al-l{text-align:left;text-align-last:left}
.bk-p.bk-al-j{text-align:justify;text-align-last:right}
.bk-p.bk-al-c{text-align:center;text-align-last:center;text-indent:0}
.bk-p.bk-sb1{margin-top:${(0.5 * lh).toFixed(3)}em}.bk-p.bk-sb2{margin-top:${(1 * lh).toFixed(3)}em}.bk-p.bk-sb3{margin-top:${(1.5 * lh).toFixed(3)}em}.bk-p.bk-sb4{margin-top:${(2 * lh).toFixed(3)}em}
.bk-p.bk-sa1{margin-bottom:${(0.5 * lh).toFixed(3)}em}.bk-p.bk-sa2{margin-bottom:${(1 * lh).toFixed(3)}em}.bk-p.bk-sa3{margin-bottom:${(1.5 * lh).toFixed(3)}em}.bk-p.bk-sa4{margin-bottom:${(2 * lh).toFixed(3)}em}
.bk-p.bk-box{border:.7pt solid #000;padding:.25em .45em;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.bk-p.bk-shade{background:#e8e8e8;padding:.25em .45em;border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bk-fig{margin:.5em 0;text-align:center;break-inside:avoid}
.bk-fig img{display:block;margin:0 auto;max-width:100%;height:auto}
.bk-fig figcaption{font-size:.86em;margin-top:.25em;text-align:center}
.bk-table{width:100%;border-collapse:collapse;margin:.4em 0;font-size:.95em;break-inside:avoid}
.bk-table td,.bk-table th{border:.6pt solid #000;padding:.15em .35em;text-align:right;vertical-align:top}
.bk-table th{font-weight:700;background:#f0f0f0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bk-p.bk-endnote{font-size:.9em;text-indent:0;margin-bottom:.15em}
.bk-enl{font-weight:700;margin-left:.3em}
.bk-adjm1{letter-spacing:-.006em;word-spacing:-.04em}.bk-adjm2{letter-spacing:-.012em;word-spacing:-.08em}.bk-adjm3{letter-spacing:-.02em;word-spacing:-.12em}
.bk-adjp1{letter-spacing:.006em;word-spacing:.05em}.bk-adjp2{letter-spacing:.014em;word-spacing:.1em}.bk-adjp3{letter-spacing:.024em;word-spacing:.16em}
.bk-endmark{font-size:.8em;margin-right:.35em}
.bk-sep.line{height:0;width:22%;margin:.7em auto;border-top:.6pt solid #000}
${st.colRule === "thin" ? ".bk-flow.c2{column-rule:.5pt solid #000}" : (st.colRule === "double" ? ".bk-flow.c2{column-rule:1.8pt double #000}" : "")}
${noteSepCSS(st)}
` + overrideCSS(st);
  return css;
}
function noteSepCSS(st){
  const v = st.noteSep || "short";
  if(v === "full") return ".bk-notes::before{width:100%}";
  if(v === "none") return ".bk-notes::before{display:none}.bk-notes{padding-top:1.4mm}";
  const mid = (content, extra) => `.bk-notes{padding-top:${extra}mm}
.bk-notes::after{content:"";position:absolute;top:${(extra / 2 - 0.2).toFixed(1)}mm;right:0;left:0;border-top:.4pt solid #000}
.bk-notes::before{content:"${content}";position:absolute;top:0;right:auto;left:50%;transform:translateX(-50%);width:auto;border:none;
 background:#fff;padding:0 2mm;font-size:.9em;line-height:1.1;white-space:nowrap;z-index:1;-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
  if(v === "orn") return mid("❖", 4);
  if(v === "text") return mid(String(st.noteSepText || "הערות וביאורים").replace(/["\\\n]/g, ""), 5) + ".bk-notes::before{font-weight:700}";
  return "";
}
// One global style per element, like Tag's style file: st.el[k] overrides what the template set.
function overrideCSS(st){
  const e = st.el || {};
  let css = "";
  const ff = (v) => v ? `font-family:${fontStack(v)};` : "";
  const sz = (v) => (v && Number(v) !== 100) ? `font-size:${Number(v) / 100}em;` : "";
  const wt = (v) => v ? `font-weight:${v === "bold" ? 700 : 400};` : "";
  const al = (v) => v ? `text-align:${v};${v === "center" ? "text-align-last:center;" : ""}` : "";
  const ls = (v) => (v != null && v !== "") ? `letter-spacing:${v}em;` : "";
  const col = (v) => v === "gray" ? "color:#555;" : "";
  const sp = (b, a) => (b != null && b !== "" ? `margin-top:${b}em;` : "") + (a != null && a !== "" ? `margin-bottom:${a}em;` : "");
  const rule = (sel, body) => { if(body) css += `${sel}{${body}}\n`; };
  const B = e.body || {};
  // v1.8.79 (Abba: "עדיין עושה הזחה של שורה ראשונה"): the indent size follows the paragraph style chosen
  // in the design tab — it never adds a first-line indent to "רווח קטן" / "צמודות" / hanging paragraphs
  const ind = (B.indent != null && B.indent !== "") ? Number(B.indent) : null;
  if(ind != null && st.paraStyle === "hang"){
    rule(".bk-p:not(.bk-center):not(.bk-quote):not(.bk-li):not(.bk-hang)", `padding-right:${ind}em;text-indent:-${ind}em;`);
    rule(".bk-p.bk-cont:not(.bk-center):not(.bk-quote):not(.bk-li):not(.bk-hang)", "text-indent:0;");
  }
  rule(".bk-p", al(B.align) + (ind != null && st.paraStyle === "indent" ? `text-indent:${ind}em;` : "") +
    (B.gap != null && B.gap !== "" ? `margin-bottom:${B.gap}em;` : "") + ls(B.ls) +
    (B.density === "tight" ? "word-spacing:-.06em;" : (B.density === "loose" ? "word-spacing:.08em;" : "")));
  const BX = e.bodyx || {};
  rule(".bk-p:not(.bk-center):not(.bk-quote):not(.bk-pasukline):not([class*=\"bk-ps-\"])", (BX.weight ? `font-weight:${BX.weight === "bold" ? 700 : 400};` : "")
    + (BX.color && FMT_COLORS[BX.color] ? `color:${FMT_COLORS[BX.color]};` : "") + (BX.u ? "text-decoration:underline;text-underline-offset:.18em;" : "")
    + (BX.indent ? `margin-right:${Number(BX.indent)}em;` : "") + (BX.before ? `margin-top:${(Number(BX.before) * (Number(st.lineHeight) || 1.5)).toFixed(3)}em;` : ""));
  const D = e.dibur || {};
  rule(".bk-p .bk-dib", ff(D.font) + sz(D.size) + `font-weight:${D.weight === "normal" ? 400 : 700};` + ls(D.ls) +
    (D.u ? "text-decoration:underline;text-underline-offset:.18em;" : ""));
  const N = e.num || {};
  rule(".bk-num", ff(N.font) + sz(N.size) + wt(N.weight));
  if(N.gap != null && N.gap !== "") rule(".bk-p.bk-entry", `margin-top:${N.gap}em;`);
  const O = e.opener || {};
  rule(".bk-open", ff(O.font) + wt(O.weight));
  if(D.font || D.size) rule(".bk-p .bk-open .bk-dib", ff(D.font) + sz(D.size));
  if(O.size) rule(".bk-open.big,.bk-open.bold,.bk-open.window,.bk-open.letter", `font-size:${Number(O.size) / 100}em;`);
  for(const k of ["h1", "h2", "h3"]){
    const H = e[k] || {};
    rule(".bk-" + k, ff(H.font) + sz(H.size) + al(H.align) + ls(H.ls) + sp(H.before, H.after) + (H.color && FMT_COLORS[H.color] ? `color:${FMT_COLORS[H.color]};` : "") + (H.u ? "text-decoration:underline;text-underline-offset:.18em;" : ""));
    if(H.weight) rule(`.bk-${k} .bk-hlabel,.bk-${k} .bk-htitle${k === "h3" ? ",.bk-h3" : ""}`, wt(H.weight));
  }
  const Q = e.quote || {};
  rule(".bk-p.bk-quote", ff(Q.font) + sz(Q.size) + wt(Q.weight) + al(Q.align) + col(Q.color) +
    (Q.indent != null && Q.indent !== "" ? `margin-right:${Q.indent}em;margin-left:${Q.indent}em;` : ""));
  const PK = e.pasuk || {};
  rule(".bk-t-p", ff(PK.font) + sz(PK.size) + `font-weight:${PK.weight === "normal" ? 400 : 700};` + ls(PK.ls) + col(PK.color)
    + (PK.u ? "text-decoration:underline;text-underline-offset:.18em;" : ""));
  // v1.8.82: a dibur that is the pasuk quote takes the pasuk look (beats the dibur rule above)
  rule(".bk-p.bk-pasukline", ff(PK.font) + sz(PK.size) + `font-weight:${PK.weight === "normal" ? 400 : 700};` + col(PK.color));
  rule(".bk-p .bk-dib.bk-dibpasuk", ff(PK.font) + sz(PK.size) + `font-weight:${PK.weight === "normal" ? 400 : 700};` + ls(PK.ls) + col(PK.color)
    + (PK.u ? "text-decoration:underline;text-underline-offset:.18em;" : "text-decoration:none;"));
  const QI = e.quoteIn || {};
  rule(".bk-t-q", ff(QI.font) + sz(QI.size) + wt(QI.weight) + (QI.ls != null && QI.ls !== "" ? `letter-spacing:${QI.ls}em;` : "") + col(QI.color)
    + (QI.u ? "text-decoration:underline;text-underline-offset:.18em;" : ""));
  const S = e.src || {};
  rule(".bk-src", ff(S.font) + (S.size ? `font-size:${Number(S.size) / 100}em;` : "") + col(S.color));
  const NT = e.notes || {};
  rule(".bk-notes", NT.leading ? `line-height:${NT.leading};` : "");
  if(NT.labelWeight) rule(".bk-nl", wt(NT.labelWeight));
  for(const P of psList(st)){
    if(P.id === "pasuk" || P.id === "quote") continue;     // their look is the element's own (el.pasuk / el.quote)
    const L = psLook(P.id, st), sel = ".bk-p.bk-ps-" + P.id;
    rule(sel, ff(L.font) + sz(L.size) + (L.weight ? `font-weight:${L.weight === "bold" ? 700 : 400};` : "") + al(L.align) + ls(L.ls) + (L.color && FMT_COLORS[L.color] ? `color:${FMT_COLORS[L.color]};` : "") + (L.u ? "text-decoration:underline;text-underline-offset:.18em;" : "")
      + (L.align === "center" ? "text-indent:0;padding-right:0;" : "") + (L.lh ? `line-height:${Number(L.lh)};` : "")
      + (L.indent != null && L.indent !== "" ? `margin-right:${L.indent}em;margin-left:${L.align === "center" ? L.indent : 0}em;` : "") + sp(L.before, L.after));
  }
  const DF = e.daf || {};
  // the daf heading: size scales the look's own size; spacing beats the look's spacing
  rule(".bk-hdaf.bk-hdaf.bk-hdaf", sz(DF.size) + al(DF.align) + ls(DF.ls) + sp(DF.before, DF.after));
  rule(".bk-hdaf.bk-hdaf.bk-hdaf .t", ff(DF.font) + wt(DF.weight));
  const HD = e.head || {};
  rule(".bk-head", ff(HD.font) + sz(HD.size) + ls(HD.ls));
  if(HD.weight) rule(".bk-head .bk-hc,.bk-head.split .bk-hr,.bk-head.split .bk-hl,.bk-head.ornate .ot b", wt(HD.weight));
  const PN = e.pnum || {};
  rule(".bk-pn,.bk-pnc,.bk-fn", sz(PN.size) + wt(PN.weight));
  const SD = e.side || {};
  rule(".bk-sideh", ff(SD.font) + sz(SD.size) + wt(SD.weight));
  const EN = e.end || {};
  if(EN.after != null && EN.after !== "") rule(".bk-p.bk-lastp", `margin-bottom:${EN.after}em;`);
  const CL = e.cols || {};
  if(CL.gap) rule(".bk-flow.c2", `column-gap:${CL.gap}mm;`);
  return css;
}

/* ----------------------------------------------------------------- parser */
function stripMarks(s, st){
  if(st.hideTeamim) s = s.replace(/[\u0591-\u05AF\u05BD]/g, "");
  if(st.hideNikud) s = s.replace(/[\u05B0-\u05BC\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g, "");
  return s;
}

// inline emphasis tags the toolbar inserts: <ק>small</ק> <ג>big</ג> <רש>rashi</רש> <מר>square</מר>
// <קו>underline</קו> <רו>spaced letters</רו> <אפ>gray</אפ>
const INLINE_TAGS = {"ק":"k", "ג":"g", "רש":"r", "מר":"m", "קו":"u", "רו":"v", "אפ":"a", "פס":"p", "צט":"q", "גד":"L", "קט":"S"};
const TAG_RE = /^<(\/?)(ק|ג|רש|מר|קו|רו|אפ|פס|צט|גד|קט)>/;
// v1.8.96 (Eli 11-02: "כל כלי העריכה של וורד"): the words Abba marks may take any font, size or colour
const PTAG_RE = /^<(\/?)(גופן|גודל|צבע)(?:=([^<>]{1,60}))?>/;
const ANY_TAG_G = /<\/?(?:ק|ג|רש|מר|קו|רו|אפ|פס|צט|גד|קט|גופן|גודל|צבע)(?:=[^<>]{0,60})?>/g;
// v1.8.81 (Eli 11-01: "שהציטוט יהיה חלק מהקטע ולא יוגדר כקטע בפני עצמו"): with st.quoteInline the
// whole-book quote rules mark the quote INSIDE its paragraph (<צט>…</צט>, element "ציטוט בתוך הקטע")
// instead of cutting it out as an indented paragraph: from one of Abba's words up to עכ"ל / ע"כ /
// the end of the sentence, or between quotation marks (when they are not pasuk quotes).
const QUOTE_END = '(?:עכ["״]ל|ע["״]כ|עכ["״]ד|[.:!?](?=\\s|$)|$)';
function markInlineQuotes(src, st){
  if(!st.quoteInline || !src || src.indexOf("<צט>") >= 0) return src;
  let out = src;
  for(const w of quoteWordList(st)){
    const re = new RegExp('(^|[\\s(»])(ו?' + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/["״]/g, '["״]') + '(?![א-ת])[^]*?' + QUOTE_END + ')', "g");
    out = out.replace(re, (m, a, t) => a + "<צט>" + t + "</צט>");
  }
  if(st.quoteByQuotes && !st.pasukAuto){
    out = out.replace(/(^|[^א-ת"״<])(["״])([^"״\n]{2,400}?)(["״])(?=$|[^א-ת])/g, (m, a, q1, t, q2) =>
      (/^[א-ת]{1,3}$/.test(t.replace(/[^א-ת]/g, "")) && t.length < 5) ? m : a + "<צט>" + q1 + t + q2 + "</צט>");
  }
  return out;
}
// v1.8.80 (Eli 11-01: "הספר החדש הוא על התורה ולא על הש"ס"): a pasuk quote is its own element —
// <פס>…</פס> by hand, or, by the whole-book rule st.pasukAuto, everything inside ״…״ / "…"
function markPesukim(src, st){
  if(!st.pasukAuto || !src || src.indexOf("<פס>") >= 0) return src;
  return src.replace(/(^|[^א-ת"״])(["״])([^"״\n]{2,160}?)(["״])(?=$|[^א-ת])/g, (m, a, q1, t, q2) => {
    if(/^[א-ת]{1,3}$/.test(t.replace(/[^א-ת]/g, "")) && t.length < 5) return m;   // ר"ת like מ"ש stay
    return a + "<פס>" + q1 + t + q2 + "</פס>";
  });
}
function typography(s, st){
  // what every typesetter does by hand: gershayim/geresh inside words, a real dash
  if(st.smartGeresh !== false){
    s = s.replace(/([א-ת])"(?=[א-ת])/g, "$1\u05F4").replace(/([א-ת])'(?=[\s.,:;)\]}]|$)/g, "$1\u05F3");
  }
  s = s.replace(/ - /g, " – ");
  return s;
}
function parseInline(src, st, inNote){
  src = markPesukim(src, st);
  if(!inNote) src = markInlineQuotes(src, st);
  // v1.8.86 (Abba's 10-29 book, "5.* (כט) …" / "*נראה לומר …"): a * left without its partner in this
  // paragraph (the pair was typed across a line break) made the WHOLE rest of the paragraph bold.
  // A lone * is dropped; only *…* pairs inside the paragraph bold.
  const stars = [];
  for(let i = 0, d = 0; i < src.length; i++){ if(src[i] === "{") d++; else if(src[i] === "}") d = Math.max(0, d - 1); else if(src[i] === "*" && !d) stars.push(i); }
  if(stars.length % 2) src = src.slice(0, stars[stars.length - 1]) + src.slice(stars[stars.length - 1] + 1);
  const toks = [], notes = [];
  let bold = false, paren = 0, segs = [], pending = [];
  const fl = {};                          // active inline tags
  const pv = {font: [], size: [], color: []};   // the marked words' own font / size / colour (innermost wins)
  const flags = () => Object.keys(fl).filter(k => fl[k]).sort().join("") + "|" + pv.font.join(",") + "|" + pv.size.join(",") + "|" + pv.color.join(",");
  const pstyle = () => {
    let c = "";
    const f = pv.font[pv.font.length - 1], z = pv.size[pv.size.length - 1], k = pv.color[pv.color.length - 1];
    if(f) c += "font-family:" + fontStack(f).replace(/"/g, "'") + ";";
    if(z) c += "font-size:" + (Math.max(40, Math.min(300, Number(z) || 100)) / 100) + "em;";
    if(k && FMT_COLORS[k]) c += "color:" + FMT_COLORS[k] + ";";
    return c;
  };
  const flush = () => {
    if(!segs.length && !pending.length) return;
    let html = "";
    for(const g of segs){
      if(g.mk != null){ html += "\u0001" + g.mk + "\u0002"; continue; }   // note marker goes exactly here
      let x = esc(g.t);
      if(g.p && st.sourcesSmall && !inNote) x = "<span class=\"bk-src\">" + x + "</span>";
      if(g.f){ const [cls, fF, fZ, fK] = g.f.split("|"); for(const c of cls) x = "<span class=\"bk-t-" + c + "\">" + x + "</span>";
        if(g.sty) x = "<span style=\"" + g.sty + "\">" + x + "</span>"; }
      if(g.b) x = "<b>" + x + "</b>";
      html += x;
    }
    toks.push({h: html, notes: pending});
    segs = []; pending = [];
  };
  const add = (ch) => {
    const last = segs[segs.length - 1], p = paren > 0, f = flags();
    if(last && last.mk == null && last.b === bold && last.p === p && last.f === f) last.t += ch;
    else segs.push({t: ch, b: bold, p, f, sty: pstyle()});
  };
  for(let i = 0; i < src.length; i++){
    const c = src[i];
    if(c === "<"){
      const m = src.slice(i, i + 6).match(TAG_RE);
      if(m){ fl[INLINE_TAGS[m[2]]] = !m[1]; i += m[0].length - 1; continue; }
      const q = src.slice(i, i + 72).match(PTAG_RE);
      if(q){
        const key = {"גופן":"font", "גודל":"size", "צבע":"color"}[q[2]];
        if(q[1]) pv[key].pop(); else pv[key].push(String(q[3] || "").trim());
        i += q[0].length - 1; continue;
      }
    }
    if(c === "{" && !inNote){
      const dbl = src[i + 1] === "{";
      const close = dbl ? src.indexOf("}}", i + 2) : src.indexOf("}", i + 1);
      if(close < 0){ add(c); continue; }
      const body = src.slice(i + (dbl ? 2 : 1), close).trim();
      i = close + (dbl ? 1 : 0);
      if(!body) continue;
      const idx = notes.push({s: dbl ? "b" : "a", toks: parseNote(body, st)}) - 1;
      if(segs.length){ pending.push(idx); segs.push({mk: idx}); }
      else if(toks.length) toks[toks.length - 1].notes.push(idx);
      else pending.push(idx);
      continue;
    }
    if(c === "*"){ bold = !bold; continue; }
    if(c === " " || c === "\t" || c === "\u00a0" || c === "\n"){ flush(); continue; }
    if(c === "("){ paren++; add(c); continue; }
    if(c === ")"){ add(c); if(paren > 0) paren--; continue; }
    add(c);
  }
  flush();
  // keep "ר' משה", "ב' שיטות" together on one line
  if(st.keepAbbrev !== false){
    for(let i = toks.length - 2; i >= 0; i--){
      const t = toks[i].h.replace(/<[^>]+>|\u0001\d+\u0002/g, "");
      if(/^[א-ת]{1,2}['\u05F3]$/.test(t) && !toks[i].notes.length){
        toks[i] = {h: toks[i].h + "\u00a0" + toks[i + 1].h, notes: toks[i + 1].notes};
        toks.splice(i + 1, 1);
      }
    }
  }
  return {toks, notes};
}
function parseNote(body, st){
  const toks = parseInline(body, st, true).toks.map(t => t.h);
  if(st.noteDibur){
    let dib = -1;
    for(let i = 0; i < Math.min(toks.length, 16); i++){
      const t = toks[i].replace(/<[^>]+>/g, "");
      if(/^[-–—]$/.test(t)){ dib = i; break; }
      if(i < 10 && /[.:]$/.test(t)){ dib = i + 1; break; }
    }
    if(dib > 0) for(let i = 0; i < dib; i++) toks[i] = "<b class=\"bk-dib\">" + toks[i] + "</b>";
  }
  return toks;
}
function startsWithWord(title, word){
  title = String(title || "").trim(); word = String(word || "").trim();
  return !!word && (title === word || title.startsWith(word + " "));
}
function splitLabel(title, word){
  // "פרק א - בדיני ברכות" -> label "פרק א", title "בדיני ברכות" (printed on two lines)
  const m = String(title).match(/^(\S+\s+\S{1,6}?['"׳״]?)\s*[-–—:.,]\s*(.+)$/);
  if(m && startsWithWord(m[1], word)) return {label: m[1].trim(), title: m[2].trim()};
  if(startsWithWord(title, word) && title.split(/\s+/).length <= 2) return {label: title, title: ""};
  return null;
}
const G_VAL = {"א":1,"ב":2,"ג":3,"ד":4,"ה":5,"ו":6,"ז":7,"ח":8,"ט":9,"י":10,"כ":20,"ך":20,"ל":30,"מ":40,"ם":40,
  "נ":50,"ן":50,"ס":60,"ע":70,"פ":80,"ף":80,"צ":90,"ץ":90,"ק":100,"ר":200,"ש":300,"ת":400};
function isHebNum(tok){
  // a real Hebrew numeral: letters in non-increasing value (טו/טז allowed), so "וכו" is not one
  tok = String(tok || "");
  if(!tok || tok.length > 4) return false;
  if(/^(טו|טז)$/.test(tok) || /(טו|טז)$/.test(tok) && isHebNum(tok.slice(0, -2) || "א")) return true;
  let prev = Infinity;
  for(const ch of tok){ const v = G_VAL[ch]; if(v == null || v > prev) return false; prev = v; }
  return true;
}

// v1.8.82 (Eli 11-01: "דיבור המתחיל מוגדר על ידי סימנים שונים, בין השאר חצי סוגר מרובע; וזה גם
// יגדיר מהו ציטוט מפסוק שבו מתחיל ד"ה"): the dibur ends at any of the marks chosen for the whole
// book — dash, dot, colon, comma, a half square bracket (בראשית ברא] …, the way the sefarim on the
// Torah print the words of the pasuk) or a half parenthesis — and may be laid out as a pasuk quote.
const DIBUR_MARKS = [["dash", "מקף <bdi dir=\"ltr\">–</bdi>"], ["dot", "נקודה <bdi dir=\"ltr\">.</bdi>"], ["colon", "נקודתיים <bdi dir=\"ltr\">:</bdi>"],
  ["comma", "פסיק <bdi dir=\"ltr\">,</bdi>"], ["bracket", "חצי סוגר מרובע <bdi dir=\"ltr\">]</bdi>"], ["paren", "חצי סוגר עגול <bdi dir=\"ltr\">)</bdi>"]];
function diburMarkSet(st){
  // the chosen marks; a book from before v1.8.82 keeps what its single "עד איפה" choice meant
  const own = String(st.diburMarks || "").split(",").map(x => x.trim()).filter(x => DIBUR_MARKS.some(m => m[0] === x));
  if(own.length) return own;
  const u = st.diburUntil || "auto";
  return (u === "auto" || u === "words" || u === "marks") ? ["dash", "dot"] : [u];
}
function diburMarksText(st){
  if((st.diburUntil || "auto") === "words") return (Number(st.diburWords) || 3) + " מילים";
  return diburMarkSet(st).map(k => (DIBUR_MARKS.find(m => m[0] === k) || ["", k])[1].replace(/<[^>]+>/g, "")).join(" / ");
}
const ETC_RE = /^(וגו|וכו|וגומר)['׳]?[.,:]?$/;
function diburEnd(toks, st, loose){
  // where the דיבור המתחיל ends, by the book's one global rule.
  // A paragraph without a number gets a dibur only when it is a short opening:
  // a whole first sentence is not a dibur. An explicit half bracket is a deliberate mark,
  // so it may close a longer pasuk (up to 24 words).
  const until = st.diburUntil || "auto";
  const plain = (i) => toks[i].h.replace(/<[^>]+>|\u0001\d+\u0002/g, "");
  // Eli (11-01): "הפירוש מתחיל עם תחילת הציטוט ונגמר ב'וגו'" — וגו' / וכו' closes the dibur wherever it stands
  for(let i = 0; i < Math.min(toks.length, 24); i++) if(ETC_RE.test(plain(i))) return i + 1;
  if(until === "words") return Math.min(toks.length, Math.max(1, Number(st.diburWords) || 3));
  const marks = diburMarkSet(st), has = (m) => marks.includes(m);
  const pas = !!st.diburPasuk;   // the dibur IS the pasuk: it may run 24 words, whatever the mark
  const dashMax = pas ? 24 : loose ? 12 : 18, endMax = pas ? 24 : loose ? 8 : 14, markMax = 24;
  const scan = Math.min(toks.length, (pas || has("bracket") || has("paren")) ? Math.max(dashMax, markMax) : dashMax);
  let seen = "";
  for(let i = 0; i < scan; i++){
    const t = plain(i);
    if(i < dashMax && has("dash") && /^[-–—]$/.test(t)) return i;
    if(i < endMax && has("dot") && /\.$/.test(t)) return i + 1;
    if(i < endMax && has("colon") && /:$/.test(t)) return i + 1;
    if(i < endMax && has("comma") && /,$/.test(t)) return i + 1;
    // a HALF bracket: one bracket with no partner before it (so "[שם]" is not a mark). Typed as
    // ] or as [ — in Hebrew text the two look alike on the screen.
    if(has("bracket") && /[\]\[]["'״׳.,:]?$/.test(t) && !/[\]\[]/.test(seen) && (t.match(/[\]\[]/g) || []).length === 1) return i + 1;
    if(has("paren") && /\)["'״׳.,:]?$/.test(t) && !/[()]/.test(seen) && !/\(/.test(t)) return i + 1;
    seen += t;
  }
  return -1;
}
function boldDibur(toks, st, loose){
  if(!toks.length || /^<b/.test(toks[0].h)) return true;   // already bold by Abba's own * … *
  const dib = diburEnd(toks, st || {}, loose);
  if(dib <= 0) return false;
  {
    // "הדיבור המתחיל הוא ציטוט מפסוק": the opening words also take the pasuk-quote look
    const cls = "bk-dib" + (st && st.diburPasuk ? " bk-t-p bk-dibpasuk" : "");
    for(let i = 0; i < dib; i++) toks[i] = {h:"<span class=\"" + cls + "\">" + toks[i].h + "</span>", notes:toks[i].notes};
    if(st && st.diburNewLine && dib < toks.length) toks[dib - 1].h += "<br class=\"bk-dibbr\">";
  }
  return true;
}
function diburWhere(st){
  if(st.diburWhere) return st.diburWhere;
  return st.bodyDibur ? "numbered" : "none";
}
function fmtNum(n, punct, st){
  const f = st.numFormat || "keep";
  if(f === "dot") return n + ".";
  if(f === "paren") return n + ")";
  if(f === "both") return "(" + n + ")";
  if(f === "bracket") return "[" + n + "]";
  if(f === "half") return n + "]";
  return n + punct;
}
const SEP_MARKS = {stars:"✻ ✻ ✻", star2:"★ ☆ ★", diamonds:"◆ ◇ ◆", orn:"❖", dots:"• • •"};
// Margin headings get their own margin column only on a one-column page: in two
// columns there is no margin beside the left column, so they run in, bold, at the
// start of their paragraph (as in two-column halacha books).
function sideMargin(book, st){ return bookHasSide(book) && (Number(st.columns) || 1) < 2; }
function bookHasSide(book){
  return (book.sections || []).some(s => /(^|\n)\s*\[\[.+?\]\]/.test(String(s.text || "")));
}
// The lines of a section as [text, line-number] pairs; the line number of the first line of a
// paragraph is kept (for jumps/adj). An empty line, a heading, a centred line, a quote, a
// separator or a numbered line always starts a new paragraph. Then, by st.paraJoin:
//   "line"    — every line is a paragraph;
//   "section" — all plain lines of a part run together into one paragraph;
//   "" (auto) — Abba (11-01): "המערכת לא מזהה נכון מהי פיסקה". Text copied from a printed book
//               (Otzar, PDF) comes broken into its printed lines. Such a part is recognised (most
//               lines short-ish, of like length, and NOT ending a sentence) and its lines are joined
//               back; a paragraph ends where a line ends a sentence (. : ׃ ? !) and is shorter than
//               a full line. A part written one paragraph per line stays exactly as written.
// v1.8.80 (Eli 11-01: "אבא יוכל להגדיר ידני לכל הספר מהי פסקה ומהו ציטוט ולא פסקה"): whole-book
// rules for what counts as a quote, beside the > mark — a paragraph that opens with a quotation
// mark, with one of Abba's words (וז"ל, כתב, אמר…), or a line typed with a tab / spaces in front.
function quoteWordList(st){
  return String(st.quoteWords || "").split(/[,\n;]+/).map(x => x.trim()).filter(Boolean);
}
function isQuoteRule(raw, st){
  const s = String(raw || "").replace(/^\s*(»+\s*|\[\[.+?\]\]\s*)/, "").trim();
  if(!s || /^(#|=|>|~~|\(|(\*\s*){3,}$|(✻\s*){3}$)/.test(s)) return false;
  if(st.quoteByQuotes && /^["״“„«']/.test(s)) return true;
  if(st.quoteByIndent && /^(\t| {2,})\S/.test(String(raw || "").replace(/^(»+)/, ""))) return true;
  for(const w of quoteWordList(st)){
    if(s.startsWith(w) || s.startsWith("ו" + w)) return true;
  }
  return false;
}
const PARA_SPECIAL = (s) => /^(#|=|>|»|~~|%%|\||@@|\[\[|\((?:[א-ת]{1,3}|\d{1,3})\)\s|(\*\s*){3,}$|(✻\s*){3}$)/.test(s)
  || /^([א-ת]{1,3}|\d{1,3})[.)\]]\s/.test(s);
const PARA_END = /[.:\u05C3?!]["'״׳)\]]*$/;
function printedLines(lines){
  const plain = lines.map(x => x.trim()).filter(x => x && !PARA_SPECIAL(x));
  if(plain.length < 6) return 0;
  const lens = plain.map(x => x.length).sort((a, b) => a - b);
  const med = lens[Math.floor(lens.length / 2)], full = lens[Math.floor(lens.length * 0.8)];
  if(med < 20 || med > 130) return 0;
  const open = plain.filter(x => !PARA_END.test(x)).length;
  const alike = plain.filter(x => x.length >= full * 0.7).length;
  return open >= plain.length * 0.5 && alike >= plain.length * 0.5 ? full : 0;
}
// v1.8.82 (Eli 11-01, for the sefer Abba is writing now: "כל קטע יתחיל בציטוט מודגש של פסוק מהפרשה
// ובסופו נקודותיים"): a line OPENS a section when its first words (after an optional number) run up to
// a colon within 24 words with no full stop before it and no quotation mark in front — the bare words
// of the pasuk. A pasuk quoted inside a section is written in quotation marks or follows unfinished
// text, so it never opens a new section (a new section also needs the one before it to have ended
// its sentence). A per-book choice (paraJoin "pasuk"), not a rule for every book.
const PASUK_OPEN_MAX = 24;
// Eli (11-01): no guessing — Abba says which mark closes the opening pasuk in THIS book (a colon, a half
// square bracket ] , a dash…; st.diburMarks, the same marks that end the dibur). Returns how many words
// the opening pasuk has, 0 when the line does not open a section.
function pasukOpener(s, st){
  s = String(s || "").trim().replace(/^(»+\s*|\[\[.+?\]\]\s*)/, "").replace(/^\(?([א-ת]{1,3}|\d{1,3})[.)\]]\s+/, "");
  if(!s || PARA_SPECIAL(s) || /^["״“„«']/.test(s)) return 0;
  const marks = diburMarkSet(st || {}), has = (m) => marks.includes(m);
  const toks = s.split(/\s+/);
  let seen = "";
  for(let i = 0; i < Math.min(toks.length, PASUK_OPEN_MAX); i++){
    const t = toks[i];
    if(has("colon") && /[:\u05C3]["'״׳]?$/.test(t)) return i + 1;
    if(has("bracket") && /[\]\[]["'״׳.,:]?$/.test(t) && !/[\]\[]/.test(seen) && (t.match(/[\]\[]/g) || []).length === 1) return i + 1;
    if(has("paren") && /\)["'״׳.,:]?$/.test(t) && !/[()]/.test(seen) && !/\(/.test(t)) return i + 1;
    if(has("dash") && i > 0 && /^[-–—]$/.test(t)) return i;
    if(has("comma") && /,$/.test(t)) return i + 1;
    if(has("dot") && /\.$/.test(t) && !/^[א-ת]{1,2}["'״׳]?\.$/.test(t)) return i + 1;
    // a sentence ended before the mark: not an opening pasuk (an abbreviation like ר' is not an end)
    if(!has("dot") && /[.?!]["'״׳)\]]?$/.test(t) && !/^[א-ת]{1,2}["'״׳]?\.$/.test(t)) return 0;
    seen += t;
  }
  return 0;
}
function pasukOpenShare(book, st){
  let n = 0, k = 0;
  for(const sec of (book.sections || [])) for(const raw of String(sec.text || "").split(/\r?\n/)){
    const s = raw.trim(); if(!s || PARA_SPECIAL(s)) continue;
    n++; if(pasukOpener(s, st)) k++;
  }
  return {n, k, share: n ? k / n : 0};
}
// choosing the pasuk rule sets the whole chain for this book: every section's dibur = the opening pasuk,
// up to the mark Abba chose (a colon unless he picked another)
// v1.8.84 (Abba 11-01 21:38 + his page 22:16): the whole look of a book on the Torah in one click
function applyTorahLook(t){
  // his page: the opening word sits in a "window" (line 2 indented by exactly its width), bold up to the colon
  // when one comes within 8 words, the pasuk centred and bold, the opening word the same size as the text
  t.paraJoin = "line"; t.paraStyle = "none"; t.opener = "window"; t.openerEvery = true; t.columns = 2;
  t.diburWhere = "all"; t.diburUntil = "marks"; t.diburMarks = "colon"; t.diburPasuk = false; t.bodyDibur = true;
  t.pasukCenter = true;
  t.el = Object.assign({}, t.el || {}); t.el.opener = Object.assign({}, t.el.opener || {}, {size: 100});
}
// a line that is wholly a pasuk with nikud ("(כא) וַיִּבְרָא אֱלֹהִים ... כִּי־טוֹב:"), maybe numbered or starred
const NIKUD_RE = /[\u05B0-\u05BC\u05C1\u05C2\u05C7]/;
function isPasukLine(s){
  const t = String(s || "").replace(ANY_TAG_G, "").replace(/\*/g, "")
    .replace(/^\s*(\d{1,3}[.)\]]\s*)?(\([א-ת]{1,3}\)\s*)?/, "").trim();
  if(!t || /[{}]/.test(t)) return false;
  const w = t.split(/\s+/);
  if(w.length < 3 || w.length > 70) return false;
  const pointed = w.filter(x => NIKUD_RE.test(x)).length;
  return pointed / w.length >= 0.6 && /[:.\u05C3]\s*$/.test(t);
}
function torahLookClick(){
  applyTorahLook(st); markDirty(); scheduleLayout(0);
  if(currentTab === "design") renderDesign();
  if(currentTab === "styles" && typeof renderStyles === "function") renderStyles();
  toast("✓ כל הספר כמו בדף ששלחת: הפסוק במרכז ומודגש, כל קטע פותח במילה בחלון והשורה השנייה מוזחת לידה, מודגש עד הנקודתיים, שני טורים. אפשר לבטל עם ↶", "ok");
}
document.addEventListener("click", (e) => { if(e.target.closest && e.target.closest("#bkTorahLookBtn, #bkTorahLookBtn2")) torahLookClick(); });
function applyPasukMode(t, marks){
  t.paraJoin = "pasuk"; t.diburWhere = "all"; t.diburUntil = "marks"; t.diburPasuk = true; t.bodyDibur = true;
  if(marks) t.diburMarks = marks;
  else if(!String(t.diburMarks || "").trim() || t.diburUntil === "auto") t.diburMarks = "colon";
}
// v1.8.83 (Eli 11-01, from Abba's page): a line of 1-4 words with no closing punctuation and no mark,
// followed by a text line, is the דיבור המתחיל Abba typed on its own line before pressing Enter. It
// runs into the paragraph under it (bold, dibur look) instead of standing as a stretched two-word paragraph.
const DIB_LINE_MAX = 4;
function isDiburLine(s){
  s = String(s || "").trim();
  if(!s || PARA_SPECIAL(s) || /[{}*<>"״]/.test(s) || PARA_END.test(s) || /[,;–-]$/.test(s)) return false;
  const w = s.split(/\s+/);
  return w.length <= DIB_LINE_MAX && /[א-ת]/.test(s);
}
function joinDiburLines(paras, own){
  const out = [];
  for(let i = 0; i < paras.length; i++){
    const [s, ln] = paras[i];
    const nx = paras[i + 1];
    if(nx && isDiburLine(s) && !(own && (own.has(ln) || own.has(nx[1])))){
      const t = String(nx[0] || "").trim();
      if(t && !PARA_SPECIAL(t) && !isDiburLine(t) && !/^[{*]/.test(t)){
        const em = t.match(/^(\S+)\s+/);                 // "וגו' …" on the next line belongs to the dibur
        const etc = em && ETC_RE.test(em[1]) ? em[1] : "";
        out.push(["\u0004" + s.trim() + (etc ? " " + etc : "") + "\u0005 " + (etc ? t.slice(em[0].length) : t), ln]);
        i++;
        continue;
      }
    }
    out.push(paras[i]);
  }
  return out;
}
function paraLines(text, st, own){ const raw = paraLinesRaw(text, st, own); return st.diburLineJoin === false ? raw : joinDiburLines(raw, own); }
// the lines of a part that carry a style of their own (sec.pst) — each stands as a paragraph
function ownLines(sec){ const o = new Set(); for(const k of Object.keys((sec && sec.pst) || {})) if(k !== "*") o.add(Number(k)); return o; }
function paraLinesRaw(text, st, own){
  const lines = String(text || "").split(/\r?\n/);
  const mode = st.paraJoin === "section" ? "section" : st.paraJoin === "line" ? "line" : st.paraJoin === "pasuk" ? "pasuk" : "auto";
  const full = mode === "auto" ? printedLines(lines) : 0;
  if(mode === "line" || (mode === "auto" && !full)) return lines.map((x, i) => [x, i]);
  const out = [];
  let cur = null;
  lines.forEach((raw, i) => {
    const s = raw.trim();
    if(!s){ cur = null; return; }
    if(mode === "pasuk"){
      // a new section only where a line opens with the pasuk up to its colon; everything else goes on
      const numbered = /^\(?([א-ת]{1,3}|\d{1,3})[.)\]]\s/.test(s);   // "(ב) ויקרא…" opens its section
      if((PARA_SPECIAL(s) && !numbered) || (own && own.has(i))){ out.push([raw, i]); cur = null; return; }
      // …and only after the section before it has ended its sentence: a pasuk reached mid-sentence
      // ("ומה בא ללמדנו: …") belongs to the running section
      if(!cur || numbered || (pasukOpener(s, st) && PARA_END.test(cur[0]))){ cur = [s, i]; out.push(cur); } else cur[0] += " " + s;
      return;
    }
    // a numbered line ("1." / "א.") of printed lines goes on into the lines under it
    const numbered = mode === "auto" && /^([א-ת]{1,3}|\d{1,3})[.)\]]\s/.test(s);
    if((PARA_SPECIAL(s) && !numbered) || (own && own.has(i))){ out.push([raw, i]); cur = null; return; }
    // a quote by Abba's whole-book rule opens a paragraph of its own (its lines go on under it)
    const quote = !st.quoteInline && isQuoteRule(raw, st);
    if(quote){ cur = [raw, i]; out.push(cur); if(mode === "auto" && PARA_END.test(s) && s.length < full * 0.85) cur = null; return; }
    if(numbered) cur = null;
    if(cur) cur[0] += " " + s;
    else { cur = [s, i]; out.push(cur); }
    // printed lines: a short line that ends a sentence closes the paragraph
    if(mode === "auto" && PARA_END.test(s) && s.length < full * 0.85) cur = null;
  });
  return out;
}
// v1.8.88 (Eli 11-02: "המנוע יותאם לכל ספר ולא רק לעושה חיל"): every automatic decision the engine takes
// about a paragraph is counted, so the design tab can SHOW it ("24 פסקאות זוהו כממוספרות") with its switch,
// and a choice that changes nothing can say WHY instead of just "לא משנה".
let DETECT = {};
function buildBlocks(book, st){
  const out = [];
  DETECT = {digit: 0, item: 0, num: 0, pasuk: 0, quote: 0, afterNum: 0, paras: 0, opened: 0, dibLine: 0, noDib: 0, itemNoDib: 0};
  const ctx = {chap: 0, sim: 0, daf: "", bodyStarted:false, hadFront:false};
  for(const sec of (book.sections || [])){
    const secStart = out.length;
    const kind = sec.kind || "text";
    const title = String(sec.title || "").trim();
    let hb = null;
    // where the daf changes, a small heading "דף ה׳ ע״א" (a part with no daf of its own
    // goes on with the daf before it)
    const dl = dafLabel(sec, st.dafFormat);
    const dafB = dl && dl !== ctx.daf && st.dafSub !== "hide" ? {t:"daf", title:dl, sec:sec.id, ln:-1, uid:uid("d")} : null;
    if(dl) ctx.daf = dl;
    if(kind === "part"){
      out.push({t:"part", sec:sec.id, title, toc:0, tocTitle:title, uid:uid("p")});
    }else if(kind === "intro" || kind === "haskama"){
      const tt = title || (kind === "intro" ? "הקדמה" : "הסכמה");
      hb = {t:"h1", label:"", title:tt, hdr:tt, newPage:true, reset:"chapter", toc:1, tocTitle:tt};
    }else if(kind === "chapter" || kind === "siman"){
      const word = kind === "chapter" ? st.chapterWord : st.simanWord;
      kind === "chapter" ? ctx.chap++ : ctx.sim++;
      const own = splitLabel(title, word);
      let label = "", tt = title;
      if(own){ label = own.label; tt = own.title; }
      else if(st.autoNumber && !(kind === "siman" && st.simanNoNum) && !startsWithWord(title, word)) label = word + " " + gem(kind === "chapter" ? ctx.chap : ctx.sim);
      const hdr = [label, tt].filter(Boolean).join(" · ");
      if(kind === "siman" && st.simanStyle === "inline"){
        // run-in siman, as in the old prints: "י. דיבור המתחיל..." opens the paragraph
        const num = own ? own.label : (st.autoNumber && !st.simanNoNum && !startsWithWord(title, word) ? gem(ctx.sim) + "." : "");
        const head = own ? own.label : ((word || "סימן") + " " + gem(ctx.sim));
        hb = {t:"h2", inline:true, label:num, title:tt, hdr: tt ? head + " · " + tt : head, reset:"siman", toc:2,
              tocTitle: tt ? head + " · " + tt : head, runIn:[num, tt].filter(Boolean).join(" ")};
      }else{
        hb = kind === "chapter"
          ? {t:"h1", label, title:tt, hdr, newPage:!!st.chapterNewPage, reset:"chapter", toc:1, tocTitle:hdr, orn:true}
          : {t:"h2", label, title:tt, hdr, reset:"siman", toc:2, tocTitle:hdr};
      }
    }else if(title && st.subMode !== "hide"){
      if(st.subMode === "text"){
        const r0 = parseInline(typography(stripMarks(title, st), st), st, false);
        if(r0.toks.length) out.push({t:"p", sec:sec.id, ln:-1, toks:r0.toks, notes:r0.notes, cls:"", side:"", opener:false});
      }else hb = {t:"h3", title};
    }
    if(hb){
      if(hb.t !== "h3" && !hb.label && !hb.title) hb = null;
    }
    // headings switched off for the whole book (סגנונות): the text simply runs on
    if(hb && ((kind === "chapter" && st.hideChapter) || (kind === "siman" && st.hideSiman))) hb = null;
    // v1.8.92 (Eli 11-02: "חסר אפשרות להגדיר איפה מתחיל עמוד חדש"): "הקטע הזה מתחיל בעמוד חדש", chosen on the page
    if(sec.newPage || sec.oddPage || (st.chapterOdd && kind === "chapter")){
      const odd = !!(sec.oddPage || (st.chapterOdd && kind === "chapter"));
      if(hb){ hb.newPage = true; if(odd) hb.odd = true; } else out.push({t:"pagebreak", sec:sec.id, ln:-1, ...(odd ? {odd:true} : {})});
    }
    if(sec.head){ if(hb) hb.hdr = sec.head; else out.push({t:"hdr", sec:sec.id, ln:-1, hdr:sec.head}); }
    let numFrom = 0;
    if(sec.pnumStart > 0) numFrom = Number(sec.pnumStart);
    if(st.frontNum && !ctx.bodyStarted && !/^(intro|haskama|part)$/.test(kind)){ ctx.bodyStarted = true; if(ctx.hadFront && !numFrom) numFrom = 1; }
    if(/^(intro|haskama)$/.test(kind)) ctx.hadFront = true;
    if(numFrom && !(sec.newPage || sec.oddPage || (st.chapterOdd && kind === "chapter"))){ if(hb) hb.newPage = true; else out.push({t:"pagebreak", sec:sec.id, ln:-1}); }
    // the daf heading comes before the part's own heading, unless that heading opens a new page
    const dafAfter = kind === "part" || !!(hb && hb.newPage);
    if(dafB && !dafAfter) out.push(dafB);
    // the separator between simanim ("✻ ✻ ✻", "★ ☆ ★"...), one setting for the whole book
    // (a new daf heading already separates them)
    // v1.8.98: a DRAWN separator ("d:…", from the drawer) also parts simanim that have no heading of their own
    const partGap = hb ? hb.t === "h2" : (/^d:/.test(st.sectionSep || "") && sec.kind !== "chapter" && String(sec.text || "").trim());
    if(partGap && st.sectionSep && st.sectionSep !== "none" && out.length && out[out.length - 1].t !== "h1"
       && out[out.length - 1].t !== "part" && out[out.length - 1].t !== "daf" && out[out.length - 1].t !== "sep"){
      out.push({t:"sep", sec:sec.id, ln:-1, mark: st.sectionSep, look: st.ornLook || null});
    }
    if(hb){ hb.sec = sec.id; hb.uid = "h" + sec.id; hb.ln = -1; const hc = fmtCSS(sec.hfmt, st); if(hc) hb.css = hc; out.push(hb); }
    if(dafB && dafAfter) out.push(dafB);
    let opener = !!(hb && hb.t !== "h3" && !hb.inline) && st.opener !== "none";
    let runIn = hb && hb.inline ? hb.runIn : "";
    let afterNumbered = false, paraNo = 0;
    let lastP = null, lastTable = null;
    paraLines(sec.text, st, ownLines(sec)).forEach(([raw, ln]) => {
      const t = raw.trim();
      const ruleQuote = !st.quoteInline && isQuoteRule(raw, st);
      const inlineWhole = st.quoteInline && isQuoteRule(raw, st);   // an indented line: the whole line is the quote
      if(!t) return;
      // v1.8.94 (Eli 11-02: "תבנה הכל"): a private remark never prints; a table is made of its "|" lines;
      // a picture is its own block; "~~~0" = a blank page
      if(/^%%/.test(t)) return;
      if(/^\|/.test(t)){ const cells = t.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        if(lastTable && lastTable.sec === sec.id && lastTable.lnEnd === ln - 1){ lastTable.rows.push(cells); lastTable.lnEnd = ln; return; }
        lastTable = {t:"table", sec:sec.id, ln, lnEnd: ln, rows:[cells]}; out.push(lastTable); return; }
      lastTable = null;
      { const im = t.match(/^@@תמונה[:\s]+(\S+)(?:[:\s]+(\d{1,3}))?(?:[:\s]+(.*))?$/);
        if(im){ const I = (book.images || {})[im[1]]; if(I) out.push({t:"img", sec:sec.id, ln, src:I.src, iw:I.w, ih:I.h, w: Math.max(10, Math.min(100, Number(im[2]) || 80)), cap: String(im[3] || "").trim()}); return; } }
      { const om = t.match(/^@@עיטור[:\s]+(\S+)(.*)$/); if(om){ out.push({t:"sep", sec:sec.id, ln, mark: "d:" + om[1], look: ornLookOf(om[2])}); return; } }
      if(t === "~~~0"){ out.push({t:"blankpage", sec:sec.id, ln}); return; }
      if(t === "~~~"){ out.push({t:"pagebreak", sec:sec.id, ln}); return; }
      if(t === "~~"){ out.push({t:"colbreak", sec:sec.id, ln}); return; }
      if(t.startsWith("#") && st.subMode === "hide") return;
      if(t.startsWith("#") && st.subMode !== "text"){
        const tt = t.replace(/^#+\s*/, "");
        if(tt){ const hc = fmtCSS(sec.fmt && sec.fmt[ln], st); out.push({t:"h3", title:tt, sec:sec.id, ln, uid:"h" + sec.id + "_" + ln, ...(hc ? {css: hc} : {})}); }
        return;
      }
      let cls = "", body = st.subMode === "text" ? t.replace(/^#+\s*/, "") : t, side = "", lead = [];
      let dibLine = "";                                       // the dibur Abba typed on its own line (joinDiburLines)
      const dm = body.match(/^\u0004(.+?)\u0005\s*/);
      if(dm){ dibLine = dm[1]; body = body.slice(dm[0].length); DETECT.dibLine++; }
      const sm = body.match(/^\[\[(.+?)\]\]\s*/);          // [[כותרת בשוליים]]
      if(sm){ side = st.sideHide ? "" : sm[1].replace(ANY_TAG_G, "").trim(); body = body.slice(sm[0].length); }
      // Abba: "מבקש הזחה בכל מקום שאני רוצה" — » at the start = this paragraph indented (»» more, up to 4)
      let ind = 0;
      const iv = body.match(/^(»+)\s*/);
      if(iv){ ind = Math.min(4, iv[1].length); body = body.slice(iv[0].length); }
      if(body.startsWith("=")){ cls = "bk-center"; body = body.replace(/^=\s*/, ""); }
      else if(st.pasukCenter && isPasukLine(body)){ cls = "bk-center bk-pasukline"; body = body.replace(/^\s*\d{1,3}[.)\]]\s*/, ""); }
      else if(body.startsWith(">")){ cls = st.quotePlain ? "" : "bk-quote"; body = body.replace(/^>\s*/, ""); }
      else if(ruleQuote){ cls = st.quotePlain ? "" : "bk-quote"; }
      else if(inlineWhole && body.indexOf("<צט>") < 0 && !/^["״]/.test(body.trim())){ body = "<צט>" + body.trim() + "</צט>"; }
      // a paragraph that opens with a digit ("1. ...") — bold up to the colon, the lines after it indented
      const digit = !cls && st.digitHang !== false && /^\d{1,3}(?:[.):]\s*|\s+)\S/.test(body);
      const im = !cls && st.itemLabels !== false && body.match(/^\(([א-ת]{1,3}|\d{1,3})\)\s+/);   // (א) item
      if(im && (isHebNum(im[1]) || /^\d+$/.test(im[1]))){
        cls = "bk-li"; body = body.slice(im[0].length);
        lead.push({h:"<span class=\"bk-ilabel\">(" + esc(im[1]) + ")</span>", notes:[]});
      }
      const nm = !cls && st.numLabels && body.match(/^([א-ת]{1,3}|\d{1,3})([.)])\s+/);   // "ד." / "כח)" numbered
      let numbered = false;
      if(nm && (isHebNum(nm[1]) || /^\d+$/.test(nm[1]))){
        body = body.slice(nm[0].length);
        lead.push({h:"<span class=\"bk-num\">" + esc(fmtNum(nm[1], nm[2], st)) + "</span>", notes:[]});
        numbered = true;
        if(st.entryGap) cls = "bk-entry";
      }
      const r = parseInline(typography(stripMarks(body, st), st), st, false);
      if(dibLine){
        const dcls = "bk-dib" + (st.diburPasuk ? " bk-t-p bk-dibpasuk" : "");
        const dt = parseInline(typography(stripMarks(dibLine, st), st), st, false).toks
          .map(x => ({h:"<span class=\"" + dcls + "\">" + x.h + "</span>", notes:x.notes}));
        // Eli (11-01): "ויקרא אלקים וגו' אמור להיות באותה שורה" — the dibur Abba typed on its own line runs on, always
        r.toks = dt.concat(r.toks);
      }
      if(!r.toks.length && !lead.length) return;
      if(digit){
        cls = (cls ? cls + " " : "") + "bk-hang";
        const end = r.toks.findIndex(x => /[:\u05C3]$/.test(x.h.replace(/<[^>]+>|\u0001\d+\u0002/g, "")));
        for(let i = 0; i <= end; i++) r.toks[i] = {h:"<span class=\"bk-dlead\">" + r.toks[i].h + "</span>", notes:r.toks[i].notes};
      }
      // the דיבור המתחיל, by one global rule for the whole book
      const dw = diburWhere(st);
      const psId = sec.pst && (sec.pst[ln] || sec.pst["*"]);
      const PS = psId && psList().some(x => x.id === psId) ? psLook(psId) : null;
      const dibWanted = !(PS && PS.noDib) && !dibLine && !digit && (dw === "all" || (dw === "numbered" && (numbered || runIn)) || (dw === "first" && (numbered || runIn || paraNo === 0)));
      if(dibWanted && /^bk-li$/.test(cls) && !st.diburOnItems) DETECT.itemNoDib++;
      if(dibWanted && (!cls || cls === "bk-entry" || (cls === "bk-li" && st.diburOnItems))){
        if(!boldDibur(r.toks, st, !(numbered || runIn))) DETECT.noDib++;
      }
      paraNo++;
      // "every paragraph" openers skip the explanation that follows a numbered quote
      const openHere = opener || (st.openerEvery && st.opener !== "none" && (!afterNumbered || st.openerAfterNum));
      const adj = Number((sec.adj || {})[ln]) || 0;
      const indCls = ind ? " bk-ind" + ind : "";
      const lookCls = SEC_LOOK_CLS[sec.look] && cls !== "bk-quote" ? " " + SEC_LOOK_CLS[sec.look] : "";
      // v1.8.88 (Eli 11-02: "האות הגדולה נראית בתצוגה המקדימה אבל לא בפועל"): the opener Abba chose for the
      // whole book reaches EVERY text paragraph — a numbered one ("5. (כט) …", "(ג) …", "ד. …") takes it on its
      // first word after the number. Before, those paragraphs (24+9 of 59 in his 10-29 book) silently skipped it.
      let openAt = lead.length;
      if(digit){
        let k = 0;
        while(k < r.toks.length - 1 && /^(?:\d{1,3}[.):\]]?|\([א-ת\d]{1,3}\)|[.)\]])$/.test(r.toks[k].h.replace(/<[^>]+>|\u0001\d+\u0002/g, ""))) k++;
        openAt += k;
      }
      DETECT.paras++;
      if(digit) DETECT.digit++;
      if(/bk-li/.test(cls)) DETECT.item++;
      if(numbered) DETECT.num++;
      if(/bk-pasukline/.test(cls)) DETECT.pasuk++;
      if(/bk-quote/.test(cls)) DETECT.quote++;
      if(!opener && st.openerEvery && st.opener !== "none" && afterNumbered && !st.openerAfterNum) DETECT.afterNum++;
      // the styles "פסוק" and "ציטוט" ARE the pasuk line and the indented quote the program already knows:
      // one look each, edited in one place (styles tab), whether the line was recognised or chosen by a click
      let psCls = (PS ? " bk-ps-" + psId : "") + (PS && PS.box === "frame" ? " bk-box" : "") + (PS && PS.box === "shade" ? " bk-shade" : "");
      const AL = sec.align && sec.align[ln], SP = sec.space && sec.space[ln], KP = sec.keep && sec.keep[ln];
      if(AL) psCls += " bk-al-" + AL;
      if(SP && SP.b) psCls += " bk-sb" + Math.min(4, SP.b);
      if(SP && SP.a) psCls += " bk-sa" + Math.min(4, SP.a);
      if(psId === "pasuk"){ psCls = /bk-pasukline/.test(cls) ? "" : " bk-center bk-pasukline"; }
      if(psId === "quote"){ psCls = /bk-quote/.test(cls) ? "" : " bk-quote"; }
      const keepAll = KP === "all" || (PS && PS.keep === "all"), keepNext = KP === "next" || (PS && PS.keep === "next");
      const ownCss = fmtCSS(sec.fmt && sec.fmt[ln], st);
      const B = {t:"p", sec:sec.id, ln, toks:lead.concat(r.toks), notes:r.notes, cls:(cls + indCls + lookCls + psCls).trim(), side, adj,
                 ...(keepAll ? {keepAll:true} : {}), ...(keepNext ? {keepNext:true} : {}), ...(sec.noPnum && sec.noPnum[ln] ? {noPnum:true} : {}),
                 ...(ownCss ? {css: ownCss} : {}),
                 opener: openHere && !(PS && PS.noOpen) && !/bk-quote|bk-center/.test(cls) && !runIn && openAt < lead.length + r.toks.length, openAt};
      // a digit paragraph (bold to the colon + hang) is complete in itself: the next paragraph opens normally
      afterNumbered = numbered && !digit;
      const ow = Math.max(1, Math.min(3, Number(st.openerWords) || 1));
      if(B.opener && ow > 1 && B.toks.length > B.openAt + ow && !(B.openAt && (st.opener === "window" || st.opener === "drop"))){
        const head = B.toks.slice(B.openAt, B.openAt + ow);
        B.toks = B.toks.slice(0, B.openAt).concat([{h: head.map(x => x.h).join(" "), notes: [].concat(...head.map(x => x.notes))}], B.toks.slice(B.openAt + ow));
      }
      if(runIn){
        B.toks = runIn.split(/\s+/).map(w => ({h:"<b class=\"bk-runin\">" + esc(w) + "</b>", notes:[]})).concat(B.toks);
        B.cls = (B.cls ? B.cls + " " : "") + "bk-runp";
        runIn = "";
      }
      if(B.opener) DETECT.opened++;
      out.push(B); lastP = B; opener = false;
    });
    if(runIn){   // a siman with a title but no text yet
      out.push({t:"p", sec:sec.id, ln:-1, toks:runIn.split(/\s+/).map(w => ({h:"<b class=\"bk-runin\">" + esc(w) + "</b>", notes:[]})),
                notes:[], cls:"bk-runp", side:"", opener:false});
    }
    if(kind === "chapter" && out.length > secStart) out[secStart].chapStart = true;
    if(numFrom && out.length > secStart) out[secStart].numFrom = numFrom;
    // a part with its own number of columns: every block of it says so (the paginator opens a page for a change)
    if(sec.cols === 1 || sec.cols === 2) for(let i = secStart; i < out.length; i++) out[i].cols = sec.cols;
    if(lastP){
      lastP.lastOfSec = true;
      // the mark that closes every section (✻, ◆ ...), one setting for the whole book
      if(st.endMark && st.endMark !== "none" && lastP.toks.length){
        const mk = {star:"✻", diamond:"◆", orn:"❖", dot:"•", colon:":"}[st.endMark] || "";
        if(mk) lastP.toks.push({h:"<span class=\"bk-endmark\">" + mk + "</span>", notes:[]});
      }
    }
  }
  if(st.simanSpan && st.chapterSpan === false){
    for(let i = 0; i + 1 < out.length; i++){
      if(out[i].t === "h1" && out[i + 1].t === "h2" && !out[i + 1].inline) out[i].span = true;
    }
  }
  if(st.notesPlace === "chapter" || st.notesPlace === "book") endNotes(out, st);
  // a daf heading right above a heading that runs across both columns goes across with it
  // (otherwise it sits alone at the top of one column, over an empty one)
  for(let i = 0; i + 1 < out.length; i++){
    const B = out[i], N = out[i + 1];
    if(B.t === "daf" && ((N.t === "h2" && !N.inline && st.simanSpan) || (N.t === "h1" && (N.span || st.chapterSpan !== false)))) B.span = true;
  }
  return out;
}

// v1.8.96 (Eli 11-02: "לערוך כל דבר כמו בוורד, ואחר כך — שבכל הספר זה ייראה כך"): the look Abba gave ONE paragraph
// or heading by clicking it on the page — kept on that element only (sec.fmt[line] / sec.hfmt for the part's heading)
// until he says "שכל ה... בספר ייראו כך".
const FMT_COLORS = {gray:"#555", red:"#a3121a", blue:"#173f8a", brown:"#6b3e12"};
function fmtCSS(F, st){
  if(!F) return "";
  const lh = Number(st && st.lineHeight) || 1.5;
  let c = "";
  if(F.font) c += `font-family:${fontStack(F.font)};`;
  if(F.size && Number(F.size) !== 100) c += `font-size:${Number(F.size) / 100}em;`;
  if(F.weight) c += `font-weight:${F.weight === "bold" ? 700 : 400};`;
  if(F.color && FMT_COLORS[F.color]) c += `color:${FMT_COLORS[F.color]};`;
  if(F.align) c += `text-align:${F.align === "j" ? "justify" : F.align === "c" ? "center" : F.align === "l" ? "left" : "right"};text-align-last:${F.align === "c" ? "center" : F.align === "l" ? "left" : "right"};` + (F.align === "c" ? "text-indent:0;" : "");
  if(F.indent) c += `margin-right:${Number(F.indent)}em;`;
  if(F.lh) c += `line-height:${Number(F.lh)};`;
  if(F.ls) c += `letter-spacing:${Number(F.ls)}em;`;
  if(F.u) c += "text-decoration:underline;text-underline-offset:.18em;";
  if(F.before) c += `margin-top:${(Number(F.before) * lh).toFixed(3)}em;`;
  if(F.after) c += `margin-bottom:${(Number(F.after) * lh).toFixed(3)}em;`;
  return c;
}

// v1.8.94: the notes printed after the chapter (or at the end of the book), numbered in the text where they stand
function endNotes(out, st){
  const res = [];
  let pend = [], n = {a:0, b:0};
  const flush = (secId) => {
    if(!pend.length) return;
    res.push({t:"h3", title: st.notesTitle || "הערות", sec: secId, ln:-1, uid:uid("h")});
    for(const x of pend) res.push({t:"p", sec:x.sec, ln:-1, cls:"bk-endnote", notes:[], side:"", adj:0, opener:false,
      toks:[{h:"<span class=\"bk-enl\">" + esc(markLabel(st, x.s, x.n)) + "</span>", notes:[]}].concat(x.toks.map(k => ({h: typeof k === "string" ? k : String((k && k.h) || ""), notes:[]})))});
    pend = [];
  };
  let lastSec = "";
  for(const B of out){
    if(st.notesPlace === "chapter" && B.chapStart){ flush(lastSec); n = {a:0, b:0}; }
    if(B.t === "p" && B.notes && B.notes.length){
      B.toks = B.toks.map(k => {
        let h = k.h;
        for(const ni of k.notes || []){
          const N = B.notes[ni]; if(!N) continue;
          const s = N.s === "b" ? "b" : "a"; n[s]++;
          const mk = "<span class=\"bk-mk\">" + esc(markLabel(st, s, n[s])) + "</span>", ph = "\u0001" + ni + "\u0002";
          h = h.includes(ph) ? h.replace(ph, mk) : h + mk;
          pend.push({s, n:n[s], toks:N.toks || [], sec:B.sec});
        }
        return {h, notes:[]};
      });
      B.notes = [];
    }
    res.push(B);
    if(B.sec) lastSec = B.sec;
  }
  flush(lastSec);
  out.length = 0; for(const B of res) out.push(B);
}

/* ------------------------------------------------------------ paginator */
function markLabel(st, series, n){
  const useLetters = series === "a" ? st.noteMarker !== "num" : st.noteMarker === "num";
  return useLetters ? gem(n) : String(n);
}
function markHtml(st, series, n){
  const lab = markLabel(st, series, n);
  if(series === "a" && st.noteMarker === "paren") return "<span class=\"bk-mk paren\">(" + lab + ")</span>";
  if(series === "b") return "<span class=\"bk-mk\">" + (st.noteMarker === "num" ? "[" + lab + "]" : lab) + "</span>";
  return "<span class=\"bk-mk\">" + lab + "</span>";
}
function noteLabelHtml(st, E){
  const lab = markLabel(st, E.s, E.n);
  if(E.s === "a" && st.noteMarker === "paren") return "(" + lab + ")";
  if(E.s === "b" && st.noteMarker === "num") return "[" + lab + "]";
  return lab + (st.noteMarker === "num" || E.s === "b" ? "." : ")");
}
function noteHtml(st, E, inline){
  const words = E.N.toks.slice(E.from, E.to).join(" ");
  const label = E.cont ? "" : "<span class=\"bk-nl\">" + noteLabelHtml(st, E) + "</span>";
  const tag = inline ? "span" : "div";
  return "<" + tag + " class=\"bk-note" + (E.split ? " bk-split" : "") + (E.cont ? " bk-ncont" : "") + "\">" + label + words + "</" + tag + ">";
}

class Paginator{
  constructor(o){
    this.st = o.st; this.blocks = o.blocks; this.measure = o.measure; this.startNo = o.startNo || 1;
    this.cancelled = o.cancelled || (() => false); this.onProgress = o.onProgress || (() => {});
    this.bookTitle = o.bookTitle || ""; this.metrics = o.metrics; this.dafs = o.dafs || {};
    this.pages = []; this.cnt = {a:0, b:0}; this.carry = []; this.hdr = {chap:"", sim:""};
    this.cur = null; this.keep = null; this.t0 = performance.now();
    this.cols1 = Number(this.st.columns) !== 2;
    this.colsBook1 = this.cols1;
    this.numBase = 0;          // pages before a restart of the numbering (v1.8.94)
    // incremental layout: resume points taken at block starts, one per page
    this.ckpts = []; this.resume = o.resume || null;
  }
  // A page as plain data + an untouched DOM copy, so it can be rebuilt later.
  // heads[].el is stored as its index among the flow's children (-1: the page itself).
  snapPage(P){
    const kids = P.flow ? P.flow.children : [];
    return {n:P.n, odd:P.odd, kind:P.kind, raw:P.el.cloneNode(true), num:P.num, noNum:!!P.noNum, blank:!!P.blank, cols1:P.cols1,
      items:{a:P.items.a.slice(), b:P.items.b.slice()},
      heads:P.heads.map(hd => ({B:hd.B, idx: hd.el === P.el ? -1 : Array.prototype.indexOf.call(kids, hd.el)})),
      startHdr:{chap:P.startHdr.chap, sim:P.startHdr.sim}, secs:P.secs.slice()};
  }
  restorePage(S, live){
    const el = S.raw.cloneNode(true);
    const P = {n:S.n, odd:S.odd, el, kind:S.kind, items:{a:S.items.a.slice(), b:S.items.b.slice()}, num:S.num, noNum:S.noNum, blank:S.blank, cols1:S.cols1,
      startHdr:{chap:S.startHdr.chap, sim:S.startHdr.sim}, secs:S.secs.slice()};
    if(S.kind === "body"){
      P.body = el.querySelector(".bk-body"); P.flow = el.querySelector(".bk-flow");
      P.notes = el.querySelector(".bk-notes"); P.na = el.querySelector(".bk-notes-a"); P.nb = el.querySelector(".bk-notes-b");
      if(live) P.lb = el.querySelector(".bk-linebox");
    }
    P.heads = S.heads.map(x => ({B:x.B, el: x.idx < 0 ? el : (P.flow ? P.flow.children[x.idx] : el)}));
    if(!live) P.snap = S;
    return P;
  }
  checkpoint(i){
    if(this.keep && this.cur && this.keep.P === this.cur) return;   // a heading waits for its text
    const last = this.ckpts[this.ckpts.length - 1];
    if(last && last.pages === this.pages.length) return;
    this.ckpts.push({i, pages:this.pages.length, cnt:{a:this.cnt.a, b:this.cnt.b}, carry:this.carry.slice(), numBase:this.numBase, cols1:this.cols1, pendingNum:this.pendingNum || 0,
      hdr:{chap:this.hdr.chap, sim:this.hdr.sim}, cur: this.cur ? this.snapPage(this.cur) : null});
  }
  async tick(){
    if(performance.now() - this.t0 > 16){
      await sleep0();
      this.t0 = performance.now();
    }
    if(this.cancelled()) throw CANCELLED;
  }
  makePage(kind){
    const n = this.startNo + this.pages.length;
    const odd = n % 2 === 1;
    // the numbering asked for by the part starts on its first real page (a blank page before it does not take it)
    if(this.pendingNum && !this.makingBlank){ this.numBase = n - this.pendingNum; this.pendingNum = 0; }
    const el = h("div", {class:"bk-page " + (odd ? "odd" : "even") + " k-" + kind});
    el.dataset.n = n;
    const P = {n, odd, el, kind, items:{a:[], b:[]}, heads:[], startHdr:{chap:this.hdr.chap, sim:this.hdr.sim}, secs:[],
      num: n - this.numBase, cols1: this.cols1};
    if(kind === "body"){
      el.innerHTML = "<div class=\"bk-head\"><span class=\"bk-hr\"></span><span class=\"bk-hc\"></span><span class=\"bk-hl\"></span></div>"
        + "<div class=\"bk-body\"><div class=\"bk-flow" + (this.cols1 ? "" : " c2") + "\"></div>"
        + "<div class=\"bk-notes off\"><div class=\"bk-notes-a\"></div><div class=\"bk-notes-b\"></div></div></div>"
        + "<div class=\"bk-foot\"><span class=\"bk-fn\"></span><span class=\"bk-catch\"></span></div>";
      P.body = el.querySelector(".bk-body"); P.flow = el.querySelector(".bk-flow");
      P.notes = el.querySelector(".bk-notes"); P.na = el.querySelector(".bk-notes-a"); P.nb = el.querySelector(".bk-notes-b");
      // hidden one-column box of the real column width: counts the lines of a piece
      P.lb = h("div", {class:"bk-linebox"});
      P.lb.style.cssText = "position:absolute;top:0;right:0;visibility:hidden;width:" + ((this.cols1 ? this.metrics.colW1 : this.metrics.colW2) || this.metrics.colW || 100) + "px";
      P.body.appendChild(P.lb);
    }
    this.measure.appendChild(el);
    this.cur = P;
    if(kind === "body"){
      if(this.st.notesNumbering === "page") this.cnt = {a:0, b:0};
      if(this.carry.length) this.placeCarry(P);
    }
    return P;
  }
  page(){ return this.cur || this.makePage("body"); }
  hasFlow(P){ return !!(P && P.flow && P.flow.firstElementChild); }
  finishPage(){
    const P = this.cur;
    if(!P) return;
    this.cur = null;
    if(P.lb){ P.lb.remove(); P.lb = null; }
    if(P.kind === "body" && !this.hasFlow(P) && !P.items.a.length && !P.items.b.length && !P.blank){ P.el.remove(); return; }
    if(P.flow){ this.colTop(P); this.alignCols(P); }
    P.el.remove();
    P.snap = this.snapPage(P);   // the page before decorate(): what a later run rebuilds it from
    P.idx = this.pages.length;
    this.pages.push(P);
    this.onProgress(this.pages.length);
  }
  renderNotes(P, extraA, extraB, splitE, splitM){
    const ra = P.items.a.concat(extraA || []), rb = P.items.b.concat(extraB || []);
    const runin = this.st.noteFlow === "runin";
    const one = (E) => E === splitE ? Object.assign({}, E, {to: E.from + splitM, split:true}) : E;
    const html = (arr) => {
      if(!arr.length) return "";
      const es = arr.map(one);
      if(!runin) return es.map(E => noteHtml(this.st, E)).join("");
      // notes run on as one justified paragraph, as in most modern sefarim
      return "<p class=\"bk-nrun" + (es[es.length - 1].split ? " bk-split" : "") + "\">"
        + es.map(E => noteHtml(this.st, E, true)).join(" ") + "</p>";
    };
    P.na.innerHTML = html(ra);
    P.nb.innerHTML = html(rb);
    P.notes.classList.toggle("off", !(ra.length || rb.length));
  }
  // a paragraph that opens a column (top of the page or of the second column) gets no indent
  colTop(P){
    const ft = P.flow.getBoundingClientRect().top, tol = 0.5 * this.metrics.lh;
    const atTop = (el) => { const r = el.getClientRects()[0]; return !!r && Math.abs(r.top - ft) < tol; };
    let changed = false;
    for(const el of P.flow.children){
      if(el.tagName !== "P" || el.classList.contains("bk-cont")) continue;
      const on = atTop(el);
      if(on !== el.classList.contains("bk-ctop")){ el.classList.toggle("bk-ctop", on); changed = true; }
    }
    // the columns re-balance; one that no longer opens its column keeps its indent
    if(changed) for(const el of P.flow.querySelectorAll("p.bk-ctop")) if(!atTop(el)) el.classList.remove("bk-ctop");
  }
  // the bottom of each column, per run of columns between full-width headings
  colEnds(P){
    const f = P.flow, fr = f.getBoundingClientRect(), mid = fr.left + fr.width / 2, wide = fr.width * 0.7;
    const kids = Array.from(f.children), rects = kids.map(el => Array.from(el.getClientRects()).filter(r => r.height > 0));
    const spans = [];
    for(const rs of rects) for(const r of rs) if(r.width > wide) spans.push(r.top);
    const segs = new Map();
    kids.forEach((el, i) => rects[i].forEach((r, j) => {
      if(r.width > wide) return;
      const s = spans.filter(t => t < r.top - 0.5).length, c = r.left + r.width / 2 > mid ? 0 : 1;
      const S = segs.get(s) || {bot:[0, 0], top:[Infinity, Infinity], starts:[[], []], out:false};
      S.bot[c] = Math.max(S.bot[c], r.bottom); S.top[c] = Math.min(S.top[c], r.top);
      if(j === 0) S.starts[c].push({el, top:r.top});
      // a third column or a line past the bottom: the page no longer holds its text
      if(r.left < fr.left - 1 || r.right > fr.right + 1 || r.bottom > fr.bottom + 1) S.out = true;
      segs.set(s, S);
    }));
    segs.spans = spans.length;   // the run with this key is the last one, under every full-width heading
    return segs;
  }
  // two columns end on the same line: the shorter column's paragraph gaps take up the difference
  alignCols(P){
    if(this.cols1 || !P.flow.firstElementChild || P.flow.querySelector(".bk-colbreak")) return;
    // pin the height so the browser does not re-balance the columns once a gap grows
    const fs = P.flow.style, was = [fs.height, fs.columnFill], lh = this.metrics.lh;
    const H0 = P.flow.getBoundingClientRect().height;
    fs.height = (Math.ceil(H0 * 100) / 100 + 0.02).toFixed(2) + "px"; fs.columnFill = "auto";
    const before = this.colEnds(P), done = [];
    for(const [s, S] of before){
      if(!S.bot[0] || !S.bot[1]) continue;
      // above a full-width heading the browser always balances the columns: a gap even a little
      // short lets it re-balance them into a taller, uneven pair, so there the gaps take it all
      const pre = s < before.spans;
      const c = S.bot[0] < S.bot[1] ? 0 : 1, d = Math.abs(S.bot[0] - S.bot[1]) - (pre ? 0 : 0.5);
      if(d < 0.04 * lh) continue;
      const gaps = S.starts[c].filter(x => x.top > S.top[c] + 0.5);
      if(!gaps.length || d / gaps.length > 2 * lh) continue;
      for(const g of gaps){
        const prev = g.el.previousElementSibling;
        const m = Math.max(parseFloat(getComputedStyle(g.el).marginTop) || 0,
          prev ? parseFloat(getComputedStyle(prev).marginBottom) || 0 : 0);   // margins collapse
        done.push([g.el, g.el.style.marginTop]);
        const v = m + d / gaps.length;
        g.el.style.marginTop = (pre ? Math.ceil(v * 100) / 100 : v).toFixed(2) + "px";
      }
    }
    // nothing may move to the other column or out of the page; otherwise leave it as it was
    let ok = done.length > 0;
    const after = ok ? this.colEnds(P) : null;
    if(ok) for(const [s, S] of before){
      const A = after.get(s);
      if(!A || A.out || S.out || A.starts[0].length !== S.starts[0].length || A.starts[1].length !== S.starts[1].length
        || Math.abs(A.bot[0] - A.bot[1]) > Math.abs(S.bot[0] - S.bot[1]) + 0.5) ok = false;
    }
    if(!ok){ for(const [el, m] of done) el.style.marginTop = m; fs.height = was[0]; fs.columnFill = was[1]; }
    this.loosenCols(P);
  }
  // a run with an odd number of lines and no paragraph gap in its shorter column: as a typesetter
  // does, one paragraph is set a little looser so it takes one line more; the run then splits
  // evenly at the same height
  loosenCols(P){
    const segs = this.colEnds(P), half = P.flow.getBoundingClientRect().width / 2;
    const diff = (S) => S.bot[0] && S.bot[1] ? Math.abs(S.bot[0] - S.bot[1]) : 0;
    // the text lines of a paragraph, by column and line (inline marks share their line's top)
    const nlines = (el, ln) => {
      const r = document.createRange(); r.selectNodeContents(el);
      return new Set(Array.from(r.getClientRects()).filter(x => x.height > 0)
        .map(x => Math.round(x.left / half) + ":" + Math.round(x.top / ln))).size;
    };
    for(const [s, S] of segs){
      const d = diff(S);
      const cands = S.starts[0].concat(S.starts[1]).map(x => x.el)
        .filter(el => el.tagName === "P" && !el.classList.contains("bk-split") && !el.style.wordSpacing)
        .reverse();
      const ln = cands.length ? parseFloat(getComputedStyle(cands[0]).lineHeight) || 0 : 0;
      if(!ln || d < 0.5 * ln || d > 1.5 * ln) continue;
      let fixed = false;
      for(const el of cands){
        const n0 = nlines(el, ln);
        // a little looser (one line more) first, else a little tighter (one line fewer)
        for(const w of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, -1, -2, -3, -4, -5, -6]){
          el.style.wordSpacing = (w / 100).toFixed(2) + "em";
          if(nlines(el, ln) === n0) continue;
          const A = this.colEnds(P);
          fixed = A.get(s) && diff(A.get(s)) < 0.1 * ln && Array.from(A.values()).every(x => !x.out)
            && Array.from(segs).every(([k, B]) => !A.get(k) || diff(A.get(k)) <= diff(B) + 0.5);
          break;   // the paragraph changed by a line: keep it only if that evened the run
        }
        if(fixed) break;
        el.style.wordSpacing = "";
      }
    }
  }
  used(P){
    this.colTop(P);
    let u = P.flow.getBoundingClientRect().height;
    if(!P.notes.classList.contains("off")) u += P.notes.getBoundingClientRect().height;
    return u;
  }
  fits(P, reserve){ this.fixOrnBreaks(P); return this.used(P) <= this.metrics.bodyH - (reserve || 0) - 0.6; }
  // v1.9.01: in two columns the browser decides the column break and ignores "no break after" — so an ornament that
  // would end a column alone is told to start the NEXT column (with its paragraph). Decided once per ornament.
  fixOrnBreaks(P){
    if(!P || !P.flow || !P.flow.classList.contains("c2")) return;
    const os = P.flow.querySelectorAll(".bk-ornsep:not([data-kept])");
    if(!os.length) return;
    const ft = P.flow.getBoundingClientRect().top;
    for(const o of os){
      const n = o.nextElementSibling; if(!n) continue;
      const a = o.getBoundingClientRect(), b = n.getBoundingClientRect();
      if(b.top < a.top - 1 && a.top > ft + 2){ o.style.breakBefore = "column"; o.dataset.kept = "1"; }
    }
  }
  lines(el){
    // count in a single column of the true width, so it works in two-column mode too
    const lb = this.cur && this.cur.lb;
    if(!lb) return Math.max(1, Math.round(el.getBoundingClientRect().height / this.metrics.lh));
    lb.innerHTML = "<p class=\"" + el.className + "\"" + (el.getAttribute("style") ? " style=\"" + el.getAttribute("style").replace(/"/g, "&quot;") + "\"" : "") + ">" + el.innerHTML + "</p>";
    return Math.max(1, Math.round(lb.firstChild.getBoundingClientRect().height / this.metrics.lh));
  }
  placeCarry(P){
    const items = this.carry;
    this.carry = [];
    // a continued note never takes the whole page: the text keeps a third of it
    const reserve = Math.max(3 * this.metrics.lh, 0.35 * this.metrics.bodyH);
    for(let i = 0; i < items.length; i++){
      const E = items[i];
      P.items[E.s].push(E);
      this.renderNotes(P);
      if(this.fits(P, reserve)) continue;
      // too long for this page: keep as many words as fit, carry the rest
      P.items[E.s].pop();
      const len = E.to - E.from;
      let lo = 1, hi = len - 1, best = 0;
      while(lo <= hi){
        const m = (lo + hi) >> 1;
        this.renderNotes(P, E.s === "a" ? [E] : [], E.s === "b" ? [E] : [], E, m);
        if(this.fits(P, reserve)){ best = m; lo = m + 1; } else hi = m - 1;
      }
      if(best === 0 && !P.items.a.length && !P.items.b.length) best = Math.max(1, Math.min(len - 1, 8));
      if(best > 0){
        P.items[E.s].push(Object.assign({}, E, {to: E.from + best, split:true}));
        this.carry.push(Object.assign({}, E, {from: E.from + best, cont:true, split:false}));
      }else{
        this.carry.push(E);
      }
      for(let j = i + 1; j < items.length; j++) this.carry.push(items[j]);
      break;
    }
    this.renderNotes(P);
  }
  renderPara(B, s, k){
    let ca = this.cnt.a, cb = this.cnt.b;
    const words = [], ea = [], eb = [];
    let last = null;
    for(let i = s; i < k; i++){
      const t = B.toks[i];
      let w = t.h;
      if(i === (B.openAt || 0) && B.opener && w){
        let kind = ["drop", "big", "window", "letter"].includes(this.st.opener) ? this.st.opener : "bold";
        // a float cannot sit after a number on its line: a window / drop opener stays off numbered paragraphs
        if(B.openAt && (kind === "window" || kind === "drop")) kind = "";
        const cut = w.indexOf("\u0001");
        const head = cut < 0 ? w : w.slice(0, cut), tail = cut < 0 ? "" : w.slice(cut);
        if(!kind){}
        else if(head && kind === "letter"){
          // only the first letter (with its nikud), inside any bold/tag that opens the word
          const m = head.match(/^((?:<[^>]+>)*)([^<\s][\u0591-\u05C7]*)/);
          if(m) w = m[1] + "<span class=\"bk-open letter\">" + m[2] + "</span>" + head.slice(m[0].length) + tail;
        }else if(head) w = "<span class=\"bk-open " + kind + "\">" + head + "</span>" + tail;
      }
      for(const ni of t.notes){
        const N = B.notes[ni];
        let E;
        if(N.s === "a"){ ca++; E = {s:"a", n:ca, N, from:0, to:N.toks.length}; ea.push(E); }
        else { cb++; E = {s:"b", n:cb, N, from:0, to:N.toks.length}; eb.push(E); }
        const mk = markHtml(this.st, N.s, E.n), ph = "\u0001" + ni + "\u0002";
        w = w.includes(ph) ? w.replace(ph, mk) : w + mk;
        last = E;
      }
      if(w.indexOf("\u0001") >= 0) w = w.replace(/\u0001\d+\u0002/g, "");
      words.push(w);
    }
    let html;
    if(k === B.toks.length && this.st.noLonelyWord && words.length >= 3){
      const lw = words.pop();
      html = words.join(" ") + "\u00a0" + lw;
    }else{
      html = words.join(" ");
    }
    if(s === 0 && B.side) html = (Number(this.st.columns) >= 2 ? "<span class=\"bk-sideh bk-sidein\">" + esc(B.side) + "</span> "
      : "<span class=\"bk-sideh\">" + esc(B.side) + "</span>") + html;
    return {html, ea, eb, ca, cb, last};
  }
  commit(P, B, r, split){
    if(B.noPnum) P.noNum = true;
    for(const E of r.ea) P.items.a.push(E);
    for(const E of r.eb) P.items.b.push(E);
    if(split){
      const arr = P.items[split.E.s];
      const i = arr.indexOf(split.E);
      if(i >= 0){
        arr[i] = Object.assign({}, split.E, {to: split.E.from + split.m, split:true});
        this.carry.push(Object.assign({}, split.E, {from: split.E.from + split.m, cont:true, split:false}));
      }
    }
    this.cnt.a = r.ca; this.cnt.b = r.cb;
    if(!P.secs.includes(B.sec)) P.secs.push(B.sec);
    this.renderNotes(P);
  }
  headingEl(B){
    if(B.t === "toc"){
      const inner = "<span class=\"t\">" + esc(B.title) + "</span><span class=\"d\"></span><span class=\"n\">" + esc(B.num) + "</span>";
      return h("div", {class:"bk-toc l" + B.lvl}, B.link && B.uid ? "<a class=\"bk-tocl\" href=\"#h-" + esc(B.uid) + "\">" + inner + "</a>" : inner);
    }
    if(B.t === "sep" && /^d:/.test(B.mark || "")){
      // v1.9.01 (Eli: "לערוך ולעצב את העיטור בעמוד עצמו, במיקום ובגודל שרוצים"): every ornament has its own size / side /
      // space / look, else the book's; a click on it opens its editor (ornEditPop)
      const E = ornEff(B.look);
      const e = h("div", {class:"bk-sep bk-ornsep" + ornLookCls(E), "data-sec": B.sec, "data-ln": B.ln, "data-orn": B.mark.slice(2), title:"לחיצה — לערוך את העיטור"});
      e.innerHTML = ornSvg(B.mark.slice(2), 1.5);
      e.style.width = Math.max(8, Math.min(100, E.w)) + "%";
      e.style.marginTop = E.b + "em"; e.style.marginBottom = E.a + "em";
      e.style.marginLeft = E.align === "l" ? "0" : "auto"; e.style.marginRight = E.align === "r" ? "0" : "auto";
      if(E.h){ const sv = e.querySelector("svg"); if(sv){ sv.setAttribute("preserveAspectRatio", "none"); sv.style.height = E.h + "em"; } }
      return e;
    }
    if(B.t === "sep") return h("div", {class:"bk-sep" + (B.mark === "line" ? " line" : "")}, B.mark === "line" ? "" : esc(SEP_MARKS[B.mark] || "✻✻✻"));
    if(B.t === "colbreak") return h("div", {class:"bk-colbreak"});
    if(B.t === "img") return h("figure", {class:"bk-fig"}, `<img src="${esc(B.src)}" alt="" style="width:${B.w}%;aspect-ratio:${B.iw || 4} / ${B.ih || 3}"/>`
      + (B.cap ? "<figcaption>" + parseInline(typography(B.cap, this.st), this.st, false).toks.map(x => x.h).join(" ") + "</figcaption>" : ""));
    if(B.t === "table"){
      const cell = (c) => parseInline(typography(stripMarks(c, this.st), this.st), this.st, false).toks.map(x => x.h.replace(/\u0001\d+\u0002/g, "")).join(" ");
      return h("table", {class:"bk-table"}, "<tbody>" + B.rows.map((r, i) => "<tr>" + r.map(c => (i === 0 && B.rows.length > 1 && /^\*.*\*$/.test(c.trim()) ? "<th>" : "<td>") + cell(c) + (i === 0 && B.rows.length > 1 && /^\*.*\*$/.test(c.trim()) ? "</th>" : "</td>")).join("") + "</tr>").join("") + "</tbody>");
    }
    if(B.t === "h3") return h("div", {class:"bk-h3" + (this.st.subCenter ? " sc" : "")}, esc(B.title));
    if(B.t === "daf") return h("div", {class:"bk-hdaf lk-" + dafLookOf(this.st) + ((this.st.dafSpan || B.span) && !this.cols1 ? " span" : "")},
      "<span class=\"t\">" + esc(B.title) + "</span>");
    if(B.inline) return h("div", {class:"bk-mark"});
    const look = B.t === "h1" ? " lk-" + (this.st.chapterLook || "plain") + (B.newPage ? " np" : "") + (B.span ? " span" : "")
      : (B.t === "h2" ? " sl-" + (this.st.simanLook || "plain") + (this.st.simanSpan ? " span" : "") : "");
    const e = h("div", {class:"bk-" + B.t + look});
    if(B.uid && (B.t === "h1" || B.t === "h2" || B.t === "h3")) e.id = "h-" + B.uid;   // B7: the target of its line in the table of contents
    let html = "";
    if(B.label) html += "<span class=\"bk-hlabel\">" + esc(B.label) + "</span>";
    if(B.title) html += "<span class=\"" + (B.label ? "bk-htitle" : "bk-hlabel") + "\">" + esc(B.title) + "</span>";
    if(B.t === "h1" && B.orn && (this.st.chapterLook || "plain") === "plain") html += "<span class=\"bk-horn\">✻ ✻ ✻</span>";
    // v1.8.98 (Eli's samples): the parasha heading inside a frame of drawn scrolls; the siman number between two curls
    if(B.t === "h1" && this.st.chapterLook === "cartouche") html = `<span class="bk-ornlook${ornLookCls(this.st.ornLook)}">` + ornCartouche(html) + "</span>";
    if(B.t === "h2" && this.st.simanLook === "curls" && B.label) html = html.replace("<span class=\"bk-hlabel\">" + esc(B.label) + "</span>", "<span class=\"bk-hlabel bk-curled" + ornLookCls(this.st.ornLook) + "\">" + ornCurlSide(false) + esc(B.label) + ornCurlSide(true) + "</span>");
    e.innerHTML = html;
    return e;
  }
  tagEl(el, B){
    if(B.sec) el.dataset.sec = B.sec;
    if(B.ln != null) el.dataset.ln = B.ln;
  }
  // v1.8.94: a part with its own number of columns starts on a page of that many columns
  setCols(B){
    const want = B && (B.cols === 1 || B.cols === 2) ? B.cols !== 2 : this.colsBook1;
    if(want === this.cols1) return;
    if(this.cur && this.hasFlow(this.cur)) this.finishPage();
    this.cols1 = want;
    if(this.cur && this.cur.flow){ this.cur.flow.classList.toggle("c2", !want); this.cur.cols1 = want;
      if(this.cur.lb) this.cur.lb.style.width = ((want ? this.metrics.colW1 : this.metrics.colW2) || this.metrics.colW || 100) + "px"; }
  }
  // the next page is an opening (odd) page: a blank page goes between if needed
  toOddPage(){
    if(this.cur && this.hasFlow(this.cur)) this.finishPage();
    const n = this.startNo + this.pages.length;
    if(n % 2 === 0){ this.makingBlank = true; const P = this.makePage("body"); this.makingBlank = false; P.blank = true; this.finishPage(); }
  }
  blankPage(){
    if(this.cur && this.hasFlow(this.cur)) this.finishPage();
    this.makingBlank = true; const P = this.cur || this.makePage("body"); this.makingBlank = false; P.blank = true; this.finishPage();
  }
  async placeHeading(B){
    this.setCols(B);
    if(B.odd) this.toOddPage();
    let P = this.page();
    if(B.newPage && this.hasFlow(P)){ this.finishPage(); P = this.page(); }
    if(B.reset === "chapter"){
      if(this.st.notesNumbering === "chapter" || this.st.notesNumbering === "siman") this.cnt = {a:0, b:0};
      this.hdr.chap = B.hdr || ""; this.hdr.sim = "";
    }else if(B.reset === "siman"){
      if(this.st.notesNumbering === "siman") this.cnt = {a:0, b:0};
      this.hdr.sim = B.hdr || "";
    }
    const el = this.headingEl(B);
    this.tagEl(el, B);
    if(B.css) el.style.cssText += B.css;
    P.flow.appendChild(el);
    if(!this.fits(P) && P.flow.firstElementChild !== el){
      el.remove();
      // headings placed just before this one (e.g. פרק then סימן) travel with it
      let group = (this.keep && this.keep.P === P) ? this.keep.els : [];
      if(group.length && P.flow.firstElementChild === group[0].el) group = [];
      for(const g of group){ g.el.remove(); const i = P.heads.indexOf(g); if(i >= 0) P.heads.splice(i, 1); }
      this.finishPage(); P = this.page();
      for(const g of group){ P.flow.appendChild(g.el); P.heads.push(g); }
      P.flow.appendChild(el);
      this.keep = group.length ? {P, els:group} : null;
    }
    const hd = {B, el};
    P.heads.push(hd);
    if(B.t === "h1" || B.t === "h2" || B.t === "h3" || B.t === "daf"){
      if(this.keep && this.keep.P === P) this.keep.els.push(hd);
      else this.keep = {P, els:[hd]};
    }
    if(!P.secs.includes(B.sec)) P.secs.push(B.sec);
  }
  moveKeepGroup(P){
    // the heading(s) just placed would end the page alone -> carry them over
    const K = this.keep;
    if(!K || K.P !== P) return null;
    const first = K.els[0].el;
    if(P.flow.firstElementChild === first) return null;   // nothing else on the page -> can't help
    for(const hd of K.els){ hd.el.remove(); const i = P.heads.indexOf(hd); if(i >= 0) P.heads.splice(i, 1); }
    this.finishPage();
    const NP = this.page();
    for(const hd of K.els){ NP.flow.appendChild(hd.el); if(!hd.para) NP.heads.push(hd); }
    this.keep = {P:NP, els:K.els};
    return NP;
  }
  async placeAtomic(B){
    this.setCols(B);
    let P = this.page();
    const el = this.headingEl(B);
    this.tagEl(el, B);
    P.flow.appendChild(el);
    if(!this.fits(P) && P.flow.firstElementChild !== el){
      el.remove();
      this.finishPage(); P = this.page();
      P.flow.appendChild(el);
    }
    if(B.t === "toc") P.heads.push({B, el});
    if(B.sec && !P.secs.includes(B.sec)) P.secs.push(B.sec);
    return {P, el};
  }
  async placePart(B){
    if(this.cur) this.finishPage();
    let guard = 0;
    while(this.carry.length && guard++ < 500){ this.makePage("body"); this.finishPage(); }
    const P = this.makePage("part");
    P.el.innerHTML = "<div class=\"bk-part\"><div class=\"t\">" + esc(B.title || "") + "</div><div class=\"o\">✻ ✻ ✻</div></div>";
    P.el.dataset.sec = B.sec;
    P.secs.push(B.sec);
    P.heads.push({B, el:P.el});
    this.hdr.chap = B.title || ""; this.hdr.sim = "";
    this.finishPage();
  }
  async placePara(B){
    this.setCols(B);
    const n = B.toks.length;
    const st = this.st;
    let s = 0, guard = 0;
    while(s < n){
      if(++guard > 5000) throw new Error("pagination loop");
      await this.tick();
      let P = this.page();
      const el = h("p");
      el.className = "bk-p" + (B.cls ? " " + B.cls : "") + (s > 0 ? " bk-cont" : "") + (B.adj ? " bk-adj" + (B.adj > 0 ? "p" : "m") + Math.min(3, Math.abs(B.adj)) : "");
      if(B.css) el.style.cssText = B.css;
      this.tagEl(el, B);
      P.flow.appendChild(el);
      const attempt = (k) => {
        const r = this.renderPara(B, s, k);
        el.innerHTML = r.html;
        el.classList.toggle("bk-split", k < n);
        el.classList.toggle("bk-lastc", k === n && ((!!B.lastOfSec && !!st.centerLastLine) || (!!st.centerEvery && (!B.cls || B.cls === "bk-entry"))));
        el.classList.toggle("bk-lastp", k === n && !!B.lastOfSec);
        this.renderNotes(P, r.ea, r.eb);
        return r;
      };
      const keepHere = this.keep && this.keep.P === P && s === 0;
      // 1) the whole remainder
      let r = attempt(n);
      if(this.fits(P)){
        this.commit(P, B, r, null);
        this.keep = null;
        // "keep with the next paragraph": it travels with the next one like a heading does
        if(B.keepNext && s === 0) this.keep = {P, els:[{B, el, para:true}]};
        return;
      }
      if(B.keepAll && s === 0 && P.flow.firstElementChild !== el && !(this.keep && this.keep.P === P)){
        el.remove(); this.renderNotes(P); this.finishPage(); continue;
      }
      const totalLines = this.lines(el);
      // 2) the longest piece that fits, notes included
      let lo = s + 1, hi = n - 1, best = s;
      while(lo <= hi){
        const mid = (lo + hi) >> 1;
        attempt(mid);
        if(this.fits(P)){ best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      // 3) a long note may continue on the next page if that fills this one
      let split = null;
      let gap = 0;
      if(best > s){ attempt(best); gap = this.metrics.bodyH - this.used(P); }
      else gap = this.metrics.bodyH - this.used(P);
      if(best === s || gap > 3 * this.metrics.lh){
        let res = this.searchSplit(P, B, s, n, best, attempt);
        if(res && res.split && res.k < n){
          // same rule as below: the page must end at the end of a line
          attempt(res.k); const L1 = this.lines(el);
          attempt(res.k + 1); const L2 = this.lines(el);
          if(L2 === L1 && L1 >= 2){
            let lo3 = s + 1, hi3 = res.k - 1, k3 = s;
            while(lo3 <= hi3){
              const mid = (lo3 + hi3) >> 1;
              attempt(mid);
              if(this.lines(el) <= L1 - 1){ k3 = mid; lo3 = mid + 1; } else hi3 = mid - 1;
            }
            res = k3 > best ? (this.searchSplit(P, B, s, k3, Math.max(s, k3 - 1), attempt) || null) : null;
          }else if(L2 === L1){
            res = null;   // one partial line at the foot of the page: start the paragraph overleaf
          }
        }
        if(res && res.split){ best = res.k; split = res.split; }
        else if(res && res.k > best){ best = res.k; }
      }
      // 4a) a page ends at the end of a line. If the next word's note pushed the
      //     break into the middle of a line, end at the previous full line.
      if(best > s && best < n && !split){
        attempt(best); const L1 = this.lines(el);
        attempt(best + 1); const L2 = this.lines(el);
        if(L2 === L1 && L1 >= 2){
          let lo3 = s + 1, hi3 = best - 1, k3 = s;
          while(lo3 <= hi3){
            const mid = (lo3 + hi3) >> 1;
            attempt(mid);
            if(this.lines(el) <= L1 - 1){ k3 = mid; lo3 = mid + 1; } else hi3 = mid - 1;
          }
          best = k3;
        }
      }
      // 4b) widows and orphans
      // (never at the price of a hole: a widow is only fixed if 2+ lines stay here)
      if(st.widows && best > s && !split){
        attempt(best);
        let L = this.lines(el);
        if(totalLines - L === 1 && totalLines >= 3 && L - 1 >= 2){
          let lo2 = s + 1, hi2 = best - 1, k2 = s;
          while(lo2 <= hi2){
            const mid = (lo2 + hi2) >> 1;
            attempt(mid);
            if(this.lines(el) <= L - 1){ k2 = mid; lo2 = mid + 1; } else hi2 = mid - 1;
          }
          best = k2;
          if(best > s){ attempt(best); L = this.lines(el); }
        }
        if(best > s && L < 2 && totalLines >= 2 && P.flow.firstElementChild !== el) best = s;
      }
      // 5) a heading must not stay alone at the bottom of a page
      if(keepHere){
        let placed = 0;
        if(best > s){ attempt(best); placed = this.lines(el); }
        if(placed < Math.min(2, totalLines || 2)){
          el.remove();
          this.renderNotes(P);
          const NP = this.moveKeepGroup(P);
          if(NP) continue;
          P.flow.appendChild(el);
        }
      }
      if(best > s){
        const rr = attempt(best);
        const sp = this.rebind(rr, split);
        if(sp) this.renderNotes(P, rr.ea, rr.eb, sp.E, sp.m);
        el.classList.toggle("bk-split", best < n);
        this.commit(P, B, rr, sp);
        this.keep = null;
        this.finishPage();
        s = best;
        continue;
      }
      // nothing fits here
      el.remove();
      this.renderNotes(P);
      if(this.hasFlow(P)){ this.finishPage(); continue; }
      // empty page (perhaps holding notes carried from before) and still nothing
      // fits: a giant note. Put at least one whole line here, its note split.
      P.flow.appendChild(el);
      let kLine = s + 1;
      { let lo4 = s + 1, hi4 = n;
        while(lo4 <= hi4){ const mid = (lo4 + hi4) >> 1; attempt(mid); if(this.lines(el) <= 1){ kLine = mid; lo4 = mid + 1; } else hi4 = mid - 1; } }
      const forced = this.searchSplit(P, B, s, kLine, s, attempt, true);
      const hasCarry = P.items.a.length || P.items.b.length;
      if(hasCarry && (!forced || forced.k < kLine)){
        // the page is taken by notes carried from before: close it, go on
        el.remove();
        this.renderNotes(P);
        this.finishPage();
        continue;
      }
      const k1 = forced ? forced.k : Math.min(n, s + 1);
      const rr = attempt(k1);
      const sp = this.rebind(rr, forced ? forced.split : null);
      if(sp) this.renderNotes(P, rr.ea, rr.eb, sp.E, sp.m);
      el.classList.toggle("bk-split", k1 < n);
      this.commit(P, B, rr, sp);
      this.keep = null;
      this.finishPage();
      s = k1;
    }
  }
  rebind(r, split){
    // a render makes fresh note entries; find the one for the same note
    if(!split) return null;
    const E = r.ea.concat(r.eb).find(x => x.N === split.E.N);
    return E ? {E, m: split.m} : null;
  }
  searchSplit(P, B, s, n, floorK, attempt, force){
    const tryK = (k) => {
      const r = attempt(k);
      if(this.fits(P)) return {k, split:null};
      const E = r.last;
      if(!E) return null;
      const len = E.to - E.from;
      if(len < 2) return null;
      const minTok = force ? 1 : Math.min(len - 1, 6);
      let lo = minTok, hi = len - 1, best = 0;
      while(lo <= hi){
        const m = (lo + hi) >> 1;
        this.renderNotes(P, r.ea, r.eb, E, m);
        if(this.fits(P)){ best = m; lo = m + 1; } else hi = m - 1;
      }
      return best ? {k, split:{E, m:best}} : null;
    };
    let lo = floorK + 1, hi = n, found = null;
    while(lo <= hi){
      const mid = (lo + hi) >> 1;
      const res = tryK(mid);
      if(res){ found = res; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }
  decorate(P){
    if(P.kind !== "body") return;
    const st = this.st;
    const chapHere = P.heads.find(x => x.B.t === "h1");
    const simHere = P.heads.find(x => x.B.t === "h2");
    const chap = chapHere ? (chapHere.B.hdr || "") : P.startHdr.chap;
    const sim = simHere ? (simHere.B.hdr || "") : P.startHdr.sim;
    const opens = P.flow.firstElementChild && P.heads.some(x => x.el === P.flow.firstElementChild && x.B.t === "h1" && x.B.newPage);
    const head = P.el.querySelector(".bk-head");
    // the daf this page is on (the one at the top of the page) takes the place of the
    // chapter / siman in the running head
    let daf = "";
    if(st.dafHead !== "off") for(const s of P.secs){ if(this.dafs[s]){ daf = this.dafs[s]; break; } }
    let center = "";
    if(st.headerMode === "both") center = P.odd ? (daf || chap || sim || this.bookTitle) : (this.bookTitle || chap);
    else if(st.headerMode === "chapter") center = daf || chap || sim || this.bookTitle;
    let num = "";
    const N = P.num > 0 ? P.num : P.n;
    if(P.noNum || P.blank) num = "";
    else if(st.pageNumbers === "hebrew") num = gem(N);
    else if(st.pageNumbers === "digits") num = String(N);
    else if(st.pageNumbers === "leaf") num = P.odd ? gem((N + 1) / 2) : "";
    if(num){
      const f = st.pnumFormat || "plain";
      if(f === "dash") num = "- " + num + " -";
      else if(f === "bracket") num = "[" + num + "]";
      else if(f === "paren") num = "(" + num + ")";
      else if(f === "diamond") num = "◆ " + num + " ◆";
    }
    const hideHead = st.headerMode === "none" || (opens && st.noHeaderOnChapter);
    if(st.headerMode === "ornate" && !hideHead){
      // as in שיעורי רבי אליעזר מנשה: the name between ornamented rules, the siman under it
      head.classList.add("ornate");
      head.querySelector(".bk-hc").innerHTML = "<span class=\"ot\"><i></i>◆ <b>" + esc(this.bookTitle) + "</b> ◆<i></i></span>"
        + "<span class=\"os\">" + esc(daf || ((st.headerCenter === "chapter" ? (chap || sim) : (sim || chap)) || "").replace(/ · /, " - ")) + "</span>";
      if(num){ const pn = h("span", {class:"bk-pnc"}, esc(num)); head.appendChild(pn); }
      return;
    }
    if(st.headerMode === "split" && !hideHead){
      // as in the old prints: the book's name split over both corners, the siman between
      const words = this.bookTitle.split(/\s+/).filter(Boolean);
      const half = Math.max(1, Math.floor(words.length / 2));   // "שיעורים | יומיים (מהדו\"ק)"
      const right = words.slice(0, half).join(" "), left = words.slice(half).join(" ");
      head.classList.add("split");
      head.querySelector(".bk-hc").textContent = daf || ((st.headerCenter === "chapter" ? (chap || sim) : (sim || chap)) || "").split(" · ")[0];
      // as in the שיעורי רבי books: each half of the name over its own column, the number small at the corner
      head.querySelector(".bk-hr").textContent = right;
      head.querySelector(".bk-hl").textContent = left;
      if(num && st.pageNumPos === "top") head.appendChild(h("span", {class:"bk-pnc"}, esc(num)));
      if(num && st.pageNumPos !== "top"){ const f = P.el.querySelector(".bk-fn"); f.textContent = num; f.classList.add("bk-pn"); }
      return;
    }
    head.querySelector(".bk-hc").textContent = hideHead ? "" : center;
    const outer = head.querySelector(P.odd ? ".bk-hl" : ".bk-hr");
    const fn = P.el.querySelector(".bk-fn");
    const numTop = st.pageNumPos === "top" && !hideHead;
    if(num){
      // a chapter-opening page has no running head, so its number goes to the foot
      if(numTop){ outer.textContent = num; outer.classList.add("bk-pn"); }
      else { fn.textContent = num; fn.classList.add("bk-pn"); }
    }
    if(hideHead || (!center && !(numTop && num))) head.classList.add("off");
  }
  async run(){
    try{
      let start = 0;
      const R = this.resume;
      if(R){
        // everything before block R.i is exactly as last time: rebuild those pages and go on
        this.pages = R.pages.map((S, k) => { const P = this.restorePage(S, false); P.idx = k; return P; });
        this.cnt = {a:R.cnt.a, b:R.cnt.b}; this.carry = R.carry.slice(); this.hdr = {chap:R.hdr.chap, sim:R.hdr.sim};
        if(R.numBase != null) this.numBase = R.numBase;
        if(R.pendingNum) this.pendingNum = R.pendingNum;
        if(R.cols1 != null) this.cols1 = R.cols1;
        this.ckpts = R.ckpts.slice();
        if(R.cur){ this.cur = this.restorePage(R.cur, true); this.measure.appendChild(this.cur.el); }
        start = R.i;
      }
      for(let i = start; i < this.blocks.length; i++){
        const B = this.blocks[i];
        this.checkpoint(i);
        await this.tick();
        if(B.numFrom) this.pendingNum = Number(B.numFrom);
        if(B.t === "part") await this.placePart(B);
        else if(B.t === "h1" || B.t === "h2" || B.t === "h3" || B.t === "daf") await this.placeHeading(B);
        else if(B.t === "p") await this.placePara(B);
        else if(B.t === "sep" && /^d:/.test(B.mark || "")){
          // v1.9.01: a drawn ornament never ends a page alone — it travels with what follows it (like a heading)
          const R = await this.placeAtomic(B);
          if(this.keep && this.keep.P === R.P) this.keep.els.push({B, el:R.el, para:true}); else this.keep = {P:R.P, els:[{B, el:R.el, para:true}]};
        }
        else if(B.t === "sep" || B.t === "toc" || B.t === "colbreak") { await this.placeAtomic(B); this.keep = null; }
        else if(B.t === "pagebreak"){ if(B.odd) this.toOddPage(); else if(this.cur && this.hasFlow(this.cur)) this.finishPage(); }
        else if(B.t === "blankpage") this.blankPage();
        else if(B.t === "img" || B.t === "table"){ await this.placeAtomic(B); this.keep = null; }
        else if(B.t === "hdr"){ this.hdr.chap = B.hdr || ""; this.hdr.sim = ""; }
        else if(B.t === "pnum"){ if(this.cur && this.hasFlow(this.cur)) this.finishPage();
          this.numBase = this.startNo + this.pages.length - (Number(B.start) || 1); if(this.cur) this.cur.num = this.cur.n - this.numBase; }
      }
      let guard = 0;
      while(this.carry.length && guard++ < 500){ if(!this.cur) this.makePage("body"); this.finishPage(); }
      if(this.cur) this.finishPage();
      for(const P of this.pages) this.decorate(P);
      return this.pages;
    }finally{
      if(this.cur && this.cur.el) this.cur.el.remove();
    }
  }
}

function measureMetrics(st, measure){
  const tmp = new Paginator({st, blocks:[], measure, metrics:{bodyH:0, lh:1, colW:100}});
  const P = tmp.makePage("body");
  const p = h("p", {class:"bk-p"});
  p.style.margin = "0";
  p.textContent = "א";
  P.flow.appendChild(p);
  const one = p.getBoundingClientRect().height;
  p.innerHTML = "א<br>א<br>א";
  const three = p.getBoundingClientRect().height;
  const bodyH = P.body.getBoundingClientRect().height;
  const fw = P.flow.getBoundingClientRect().width;
  P.flow.classList.add("c2");
  const gap2 = parseFloat(getComputedStyle(P.flow).columnGap) || 0;
  P.flow.classList.toggle("c2", Number(st.columns) === 2);
  const colW1 = fw, colW2 = (fw - gap2) / 2;
  const colW = Number(st.columns) === 2 ? colW2 : colW1;
  P.el.remove();
  return {lh: Math.max(4, (three - one) / 2), bodyH, colW, colW1, colW2};
}

/* ----------------------------------------------------- front matter pages */
function frontPage(st, measure, n, html, kind){
  const odd = n % 2 === 1;
  const el = h("div", {class:"bk-page " + (odd ? "odd" : "even") + " k-" + kind}, html);
  el.dataset.n = n;
  measure.appendChild(el);
  const box = el.querySelector(".bk-tp");
  if(box){
    // shrink a too-full שער, all its lines together, until it fits the frame
    // (the corner ornaments hang outside the frame on purpose: leave them out of the test)
    const orn = [...box.querySelectorAll(".bk-c")];
    orn.forEach(x => { x.style.display = "none"; });
    const ls = [...box.querySelectorAll("[data-tps]")];
    for(let i = 0, k = 1; i < 14 && box.scrollHeight > box.clientHeight + 1; i++){
      k *= 0.92;
      ls.forEach(x => { x.style.fontSize = (parseFloat(x.dataset.tps) * k).toFixed(2) + "pt"; });
    }
    orn.forEach(x => { x.style.display = ""; });
  }
  el.remove();
  return {n, odd, el, kind, items:{a:[], b:[]}, heads:[], secs:[]};
}
/* ------------------------------------------------- the title page (שער) */
// Abba: "תן מגוון אפשרויות עיצוב לעמוד השער". The שער is a list of lines, each with its own
// look (font, size, bold, spacing, hollow letters, room above, at the bottom), inside one of
// several frames; "🎨 עיצוב שער הספר" edits it and offers ready designs. Sizes are points on
// a 17 cm wide page and grow or shrink with the page.
const TP_FRAMES = [["none","בלי מסגרת"],["single","קו דק"],["double","קו כפול"],["thick","קו עבה וקו דק"],
  ["dashed","קו מקווקו"],["round","פינות מעוגלות"],["arch","קשת למעלה"],["ornate","מסגרת מעוטרת"],["corners","קישוט בפינות בלבד"],
  ["portal","שער עמודים וגמלון"],["portalarch","שער עמודים וקשת"],["chain","שרשרת מעוינים"],["beads","שרשרת חרוזים"]];
// the gateway of the old Hebrew title pages (Bomberg's portal): two pillars on bases with
// capitals, under a pediment or an arch; drawn over the frame box, stretching with it
function tpFrameArt(frame){
  if(frame !== "portal" && frame !== "portalarch") return "";
  const P = (x) => `<path d="M${x},28 h12 v104 h-12 Z M${x - 1.5},132 h15 v8 h-15 Z M${x - 1.5},23 h15 v5 h-15 Z"/>`
    + `<path d="M${x + 3},31 v98 M${x + 6},31 v98 M${x + 9},31 v98" stroke-width=".5"/>`;
  const top = frame === "portal"
    ? `<path d="M-2,23 H102 V18 H-2 Z"/><path d="M-2,18 L50,1 L102,18 Z"/><path d="M14,16 L50,4.5 L86,16 Z" stroke-width=".5"/>`
    : `<path d="M-2,23 H102 V18 H-2 Z"/><path d="M12,28 A38,26 0 0 1 88,28"/><path d="M15,28 A35,23 0 0 1 85,28" stroke-width=".5"/><path d="M46,1.5 h8 l-1.5,6 h-5 Z"/>`;
  return `<svg class="bk-tpart" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="#000" stroke-width="1.1" vector-effect="non-scaling-stroke">`
    + top.replace(/<path /g, "<path vector-effect=\"non-scaling-stroke\" ") + (P(0) + P(88)).replace(/<path /g, "<path vector-effect=\"non-scaling-stroke\" ") + `</g></svg>`;
}
const TP_ORNS = [["line","❖ בין שני קווים"],["rule","קו פשוט"],["double","קו כפול"],["stars","★ ☆ ★"],["diam","◆ ◇ ◆"],
  ["flower","❦"],["leaf","☙ ❦ ❧"],["dots","• • •"]];
// many more: every fleuron alone, between two lines, and three in a row
const TP_ORN_GLYPHS = "✻ ✼ ✽ ✾ ❀ ✿ ❁ ❃ ❋ ✤ ✥ ✣ ✢ ❂ ✪ ✫ ✬ ✭ ✮ ✯ ✰ ✶ ✷ ✸ ✹ ✺ ❄ ❅ ❆ ✦ ✧ ◈ ❈ ❉ ❊ ⚜ ✡ ❧ ☙ ❦ ❥ ۞ ※ ⁂ ⁕ ⁜ ⸎ ❖ ◆ ◇ ⬥ ⬦ ● ○ ◉ ◎ ♦ ♢ ✠ ☩ ⚘ ❡ ¤".split(" ");
TP_ORN_GLYPHS.forEach((c, i) => { TP_ORNS.push(["g1_" + i, c], ["gl_" + i, "─ " + c + " ─"], ["g3_" + i, c + " " + c + " " + c]); });
TP_ORNS.push(["wave","〰〰〰"], ["dash3","— ◆ —"], ["pair","❧ ☙"], ["curl","☙ ❖ ❧"], ["crown","⚜ ✡ ⚜"], ["bloom","✿ ❀ ✿ ❀ ✿"]);
const TP_KINDS = {pre:"מילה מעל השם", title:"שם הספר", sub:"תת־כותרת", auth:"המחבר", place:"מקום ושנה", orn:"קישוט", free:"שורה חופשית"};
const tpL = (k, size, o) => Object.assign({k, size, font:"", bold:false, ls:0, gap:0, look:"", bottom:false, text:"", orn:"line"}, o || {});
const TP_PRESETS = [
  {k:"classic", name:"קלאסי", frame:"double", font:"", lines:[tpL("pre", 12, {text:"ספר", ls:.3, gap:6}),
    tpL("title", 30, {bold:true, gap:4}), tpL("sub", 13, {gap:5}), tpL("orn", 12, {gap:9}),
    tpL("auth", 15, {bold:true, gap:9}), tpL("place", 12, {bottom:true})]},
  {k:"ornate", name:"מעוטר", frame:"ornate", font:"b:vilnat", lines:[tpL("pre", 13, {text:"ספר", ls:.45, gap:8}),
    tpL("title", 36, {gap:3}), tpL("orn", 12, {orn:"stars", gap:5}), tpL("sub", 13, {gap:5}),
    tpL("auth", 16, {gap:12}), tpL("orn", 11, {orn:"diam", gap:5}), tpL("place", 12, {bottom:true})]},
  {k:"old", name:"כמו ספרי פעם", frame:"thick", font:"b:vilnah", lines:[tpL("free", 10, {text:"בעזרת השם יתברך"}),
    tpL("pre", 15, {text:"ספר", ls:.4, gap:10}), tpL("title", 34, {gap:2}), tpL("sub", 13, {gap:4}),
    tpL("orn", 13, {orn:"leaf", gap:8}), tpL("free", 11, {text:"חברתי אני הצעיר", gap:8}),
    tpL("auth", 16, {bold:true, gap:2}), tpL("place", 12, {bottom:true})]},
  {k:"stam", name:"אותיות סת\"ם", frame:"double", font:"b:stam", lines:[tpL("pre", 14, {text:"ספר", gap:8}),
    tpL("title", 40, {gap:2}), tpL("orn", 12, {orn:"rule", gap:6}), tpL("sub", 13, {font:"b:frank", gap:6}),
    tpL("auth", 17, {gap:14}), tpL("place", 12, {font:"b:frank", bottom:true})]},
  {k:"hollow", name:"אותיות חלולות", frame:"single", font:"b:drugulin", lines:[tpL("pre", 13, {text:"ספר", ls:.3, gap:10}),
    tpL("title", 42, {bold:true, look:"outline", gap:2}), tpL("orn", 12, {orn:"double", gap:7}), tpL("sub", 13, {gap:5}),
    tpL("auth", 16, {bold:true, gap:14}), tpL("place", 12, {bottom:true})]},
  {k:"arch", name:"שער קשת", frame:"arch", font:"b:vilnat", lines:[tpL("pre", 13, {text:"ספר", ls:.35, gap:22}),
    tpL("title", 34, {gap:3}), tpL("orn", 12, {orn:"flower", gap:6}), tpL("sub", 13, {gap:4}),
    tpL("auth", 16, {gap:12}), tpL("place", 12, {bottom:true})]},
  {k:"rashi", name:"מרובע ורש\"י", frame:"round", font:"b:frank", lines:[tpL("pre", 12, {text:"ספר", ls:.3, gap:8}),
    tpL("title", 32, {bold:true, gap:3}), tpL("sub", 13, {font:"b:mrashi", gap:6}), tpL("orn", 12, {orn:"dots", gap:8}),
    tpL("auth", 15, {font:"b:mrashi", gap:8}), tpL("place", 12, {font:"b:mrashi", bottom:true})]},
  {k:"modern", name:"מודרני", frame:"none", font:"b:bellefair", lines:[tpL("title", 38, {ls:.06, gap:40}),
    tpL("orn", 12, {orn:"rule", gap:6}), tpL("sub", 13, {gap:6}), tpL("auth", 14, {gap:26}), tpL("place", 11, {bottom:true})]},
  {k:"heavy", name:"כבד ובולט", frame:"thick", font:"b:suez", lines:[tpL("pre", 14, {text:"ספר", gap:10}),
    tpL("title", 44, {gap:2}), tpL("sub", 14, {font:"b:frank", gap:6}), tpL("orn", 13, {orn:"line", gap:8}),
    tpL("auth", 17, {gap:8}), tpL("place", 12, {font:"b:frank", bottom:true})]},
  {k:"tall", name:"צר וגבוה", frame:"single", font:"b:karantina", lines:[tpL("pre", 16, {text:"ספר", ls:.5, gap:14}),
    tpL("title", 62, {bold:true, gap:0}), tpL("orn", 12, {orn:"rule", gap:4}), tpL("sub", 16, {gap:6}),
    tpL("auth", 22, {bold:true, gap:16}), tpL("place", 15, {bottom:true})]},
  {k:"round", name:"עגול ועבה", frame:"round", font:"b:secular", lines:[tpL("pre", 13, {text:"ספר", gap:12}),
    tpL("title", 40, {gap:3}), tpL("orn", 12, {orn:"dots", gap:6}), tpL("sub", 13, {font:"b:miriam", gap:4}),
    tpL("auth", 16, {gap:14}), tpL("place", 12, {font:"b:miriam", bottom:true})]},
  {k:"simple", name:"פשוט ונקי", frame:"none", font:"b:frank", lines:[tpL("title", 30, {bold:true, gap:34}),
    tpL("sub", 13, {gap:6}), tpL("auth", 14, {gap:20}), tpL("place", 11, {bottom:true})]},
];
// Eli sent the level he means — modern sefarim title pages from Otzar: silver relief frames with
// real light and shade, scrolls, shaped panels, damask columns, a Jerusalem-stone wall around an
// arched window, raised letters, quiet classic type. Each design is ONE drawn picture of the whole
// page (SVG: lighting filters for the relief, noise for paper/stone/leather, so it prints sharp),
// locked under text boxes tied to the book details; drawn on the real page size, nothing stretches.
const tpF = (v) => (Math.round(v * 10) / 10).toString();
const tpSvgURL = (W, H, body) => "data:image/svg+xml;charset=utf-8," + ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + W + " " + H
  + "' width='" + W + "mm' height='" + H + "mm'>" + body + "</svg>").replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\n/g, " ");
const tpRng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const tpPts = (pts) => pts.map((p, i) => (i ? "L" : "M") + tpF(p[0]) + " " + tpF(p[1])).join("");
/* palettes: page, relief metal (light/mid/dark), panel, texture tint, ink */
const TP_PAL = {
  silver:{page:"#ffffff", hi:"#ffffff", mid:"#d4d4d6", lo:"#9a9a9e", panel:"#e3e3e5", tex:[.42, .42, .44], texA:.22, ink:"#111111", soft:"#555555", band:"#e8e8ea"},
  gold:{page:"#fffdf6", hi:"#fff6d2", mid:"#d9b25a", lo:"#8a6416", panel:"#efe2bf", tex:[.5, .36, .12], texA:.2, ink:"#2b1d05", soft:"#6a5220", band:"#f3e7c6"},
  navy:{page:"#ffffff", hi:"#e9eef8", mid:"#8796b8", lo:"#2e3d63", panel:"#dfe4ef", tex:[.18, .24, .4], texA:.2, ink:"#0f1a33", soft:"#3d4b6b", band:"#e4e8f1"},
  wine:{page:"#fffaf5", hi:"#f7e6e2", mid:"#b56a70", lo:"#5a1520", panel:"#ecd9d6", tex:[.4, .12, .14], texA:.2, ink:"#2a0a0e", soft:"#6d2a32", band:"#f1e0dd"},
};
// relief: the shape's own edges catch the light (top-left) and fall into shade (bottom-right)
const artFx = (P) => "<filter id='bev' x='-10%' y='-10%' width='120%' height='120%' color-interpolation-filters='sRGB'>"
  + "<feGaussianBlur in='SourceAlpha' stdDeviation='.55' result='b'/>"
  + "<feSpecularLighting in='b' surfaceScale='2.6' specularConstant='1' specularExponent='22' lighting-color='#ffffff' result='s'><feDistantLight azimuth='225' elevation='42'/></feSpecularLighting>"
  + "<feComposite in='s' in2='SourceAlpha' operator='in' result='s2'/>"
  + "<feDiffuseLighting in='b' surfaceScale='2.6' diffuseConstant='1.15' lighting-color='#ffffff' result='d'><feDistantLight azimuth='225' elevation='55'/></feDiffuseLighting>"
  + "<feComposite in='d' in2='SourceAlpha' operator='in' result='d2'/>"
  + "<feBlend in='SourceGraphic' in2='d2' mode='multiply' result='m'/>"
  + "<feComposite in='m' in2='s2' operator='arithmetic' k2='1' k3='.75'/></filter>"
  + "<filter id='sh' x='-15%' y='-15%' width='130%' height='130%'><feDropShadow dx='.5' dy='.9' stdDeviation='1.3' flood-color='#000' flood-opacity='.32'/></filter>"
  + "<filter id='tex' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.55' numOctaves='4' seed='4'/>"
  + "<feColorMatrix values='0 0 0 0 " + P.tex[0] + " 0 0 0 0 " + P.tex[1] + " 0 0 0 0 " + P.tex[2] + " 0 0 0 " + P.texA + " 0'/></filter>"
  + "<filter id='cloud' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.035' numOctaves='3' seed='9'/>"
  + "<feColorMatrix values='0 0 0 0 " + P.tex[0] + " 0 0 0 0 " + P.tex[1] + " 0 0 0 0 " + P.tex[2] + " 0 0 0 " + (P.texA * 0.7) + " 0'/></filter>"
  + "<linearGradient id='metal' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='" + P.hi + "'/><stop offset='.45' stop-color='" + P.mid + "'/><stop offset='.7' stop-color='" + P.hi + "'/><stop offset='1' stop-color='" + P.mid + "'/></linearGradient>";
// a spiral from the outside in (or the other way), sampled as points
function tpSpiral(cx, cy, R, a0, turns, dir, inward){
  const pts = [], n = Math.round(28 * turns);
  for(let i = 0; i <= n; i++){
    const t = i / n, r = R * (1 - 0.8 * t), a = a0 + dir * t * turns * 2 * Math.PI;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return inward ? pts : pts.reverse();
}
// a scroll pair: two curls joined by a wave (the classic ornament of these שערים), centre cx,cy
function artScrolls(cx, cy, w, up){
  const s = up ? -1 : 1, R = w * 0.16, xl = cx - w * 0.33, xr = cx + w * 0.33;
  const L = tpSpiral(xl, cy, R, s * Math.PI / 2 * -1, 1.6, -s, false);
  const Rr = tpSpiral(xr, cy, R, -s * Math.PI / 2, 1.6, s, true);
  const a = L[L.length - 1], b = Rr[0];
  const mid = "C" + tpF(a[0] + w * 0.12) + " " + tpF(a[1]) + " " + tpF(cx - w * 0.1) + " " + tpF(cy + s * w * 0.14) + " " + tpF(cx) + " " + tpF(cy + s * w * 0.1)
    + "C" + tpF(cx + w * 0.1) + " " + tpF(cy + s * w * 0.06) + " " + tpF(b[0] - w * 0.12) + " " + tpF(b[1]) + " " + tpF(b[0]) + " " + tpF(b[1]);
  return tpPts(L) + mid + tpPts(Rr).replace(/^M/, "L")
    + "M" + tpF(cx - w * 0.07) + " " + tpF(cy - s * w * 0.02) + "Q" + tpF(cx) + " " + tpF(cy - s * w * 0.2) + " " + tpF(cx + w * 0.07) + " " + tpF(cy - s * w * 0.02);
}
// a corner of filigree: big curls along both edges and a leaf toward the middle; a,b = corner
function artFiligree(x, y, sx, sy, k){
  const g = (d) => "<g transform='translate(" + tpF(x) + " " + tpF(y) + ") scale(" + tpF(sx * k) + " " + tpF(sy * k) + ")'>" + d + "</g>";
  const p = (d, w) => "<path d='" + d + "' fill='none' stroke='url(#metal)' stroke-width='" + w + "' stroke-linecap='round'/>";
  const leaf = "M14 14C20 12 26 15 28 22C21 23 16 20 14 14Z";
  return g(p(artScrolls(26, 6, 34, false), 2.1)
    + "<g transform='rotate(90 6 26)'>" + p(artScrolls(6, 26, 34, true), 2.1) + "</g>"
    + p(tpPts(tpSpiral(9, 9, 6.5, Math.PI, 1.4, 1, true)), 2.3)
    + "<path d='" + leaf + "' fill='url(#metal)'/><path d='M14 14L25 21' stroke='" + "#0003" + "' stroke-width='.35' fill='none'/>"
    + p("M3 44C3 52 6 58 12 60M44 3C52 3 58 6 60 12", 1.4));
}
// a panel with concave corners
const artConcave = (x, y, w, h, r) => "M" + tpF(x + r) + " " + tpF(y) + "H" + tpF(x + w - r) + "A" + r + " " + r + " 0 0 0 " + tpF(x + w) + " " + tpF(y + r)
  + "V" + tpF(y + h - r) + "A" + r + " " + r + " 0 0 0 " + tpF(x + w - r) + " " + tpF(y + h) + "H" + tpF(x + r) + "A" + r + " " + r + " 0 0 0 " + tpF(x) + " " + tpF(y + h - r)
  + "V" + tpF(y + r) + "A" + r + " " + r + " 0 0 0 " + tpF(x + r) + " " + tpF(y) + "Z";
// the tall cartouche: straight sides, a curved dome at top and bottom rising to a point, small notches
function artCartouche(x, y, w, h, dome){
  const cx = x + w / 2, n = Math.min(4, w * 0.06);
  return "M" + tpF(x) + " " + tpF(y + dome + n)
    + "Q" + tpF(x + n) + " " + tpF(y + dome + n) + " " + tpF(x + n) + " " + tpF(y + dome)
    + "C" + tpF(x + w * 0.3) + " " + tpF(y + dome) + " " + tpF(x + w * 0.36) + " " + tpF(y) + " " + tpF(cx) + " " + tpF(y)
    + "C" + tpF(x + w * 0.64) + " " + tpF(y) + " " + tpF(x + w * 0.7) + " " + tpF(y + dome) + " " + tpF(x + w - n) + " " + tpF(y + dome)
    + "Q" + tpF(x + w - n) + " " + tpF(y + dome + n) + " " + tpF(x + w) + " " + tpF(y + dome + n)
    + "V" + tpF(y + h - dome - n)
    + "Q" + tpF(x + w - n) + " " + tpF(y + h - dome - n) + " " + tpF(x + w - n) + " " + tpF(y + h - dome)
    + "C" + tpF(x + w * 0.7) + " " + tpF(y + h - dome) + " " + tpF(x + w * 0.64) + " " + tpF(y + h) + " " + tpF(cx) + " " + tpF(y + h)
    + "C" + tpF(x + w * 0.36) + " " + tpF(y + h) + " " + tpF(x + w * 0.3) + " " + tpF(y + h - dome) + " " + tpF(x + n) + " " + tpF(y + h - dome)
    + "Q" + tpF(x + n) + " " + tpF(y + h - dome - n) + " " + tpF(x) + " " + tpF(y + h - dome - n) + "Z";
}
// a cartouche in relief: metal rim with shadow, the bright panel, a fine line inside
function artPanel(shape, inset, P, panelFill){
  return "<path d='" + shape(0) + "' fill='url(#metal)' filter='url(#sh)'/><path d='" + shape(0) + "' fill='url(#metal)' filter='url(#bev)'/>"
    + "<path d='" + shape(inset) + "' fill='" + (panelFill || P.page) + "' stroke='" + P.lo + "' stroke-width='.3'/>"
    + "<path d='" + shape(inset + 1.6) + "' fill='none' stroke='" + P.mid + "' stroke-width='.35'/>";
}
const artTexRect = (x, y, w, h, P, clip) => "<rect x='" + tpF(x) + "' y='" + tpF(y) + "' width='" + tpF(w) + "' height='" + tpF(h) + "' fill='" + P.panel + "'" + (clip ? " clip-path='url(#" + clip + ")'" : "") + "/>"
  + "<rect x='" + tpF(x) + "' y='" + tpF(y) + "' width='" + tpF(w) + "' height='" + tpF(h) + "' filter='url(#tex)'" + (clip ? " clip-path='url(#" + clip + ")'" : "") + "/>"
  + "<rect x='" + tpF(x) + "' y='" + tpF(y) + "' width='" + tpF(w) + "' height='" + tpF(h) + "' filter='url(#cloud)'" + (clip ? " clip-path='url(#" + clip + ")'" : "") + "/>";
/* ------------------------------------------------ the designs (art + text boxes) */
// 1. framed cartouche (בנין אריאל): textured panel inside a scrolled frame, a tall cartouche in the middle
function artFramedCartouche(W, H, P){
  const k = W / 170, o = 9 * k;
  const frame = (d) => artConcave(o + d, o + d, W - 2 * (o + d), H - 2 * (o + d), Math.max(2, 10 * k - d));
  let s = "<defs>" + artFx(P) + "<clipPath id='inner'><path d='" + frame(6 * k) + "'/></clipPath></defs>"
    + "<rect width='" + W + "' height='" + H + "' fill='" + P.page + "'/>"
    + "<path d='" + frame(0) + "' fill='url(#metal)' filter='url(#sh)'/><path d='" + frame(0) + "' fill='url(#metal)' filter='url(#bev)'/>"
    + "<path d='" + frame(2.6 * k) + "' fill='none' stroke='" + P.lo + "' stroke-width='.3'/>"
    + artTexRect(0, 0, W, H, P, "inner") + "<path d='" + frame(6 * k) + "' fill='none' stroke='" + P.lo + "' stroke-width='.4'/>";
  for(const [x, y, sx, sy] of [[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]])
    s += "<g transform='translate(" + tpF(x) + " " + tpF(y) + ") scale(" + tpF(sx * k) + " " + tpF(sy * k) + ")'>"
      + "<path d='" + tpPts(tpSpiral(1, 1, 6, Math.PI * 1.25, 1.5, 1, true)) + "M3 -1C9 -3 15 -1 18 3M-1 3C-3 9 -1 15 3 18' fill='none' stroke='" + P.mid + "' stroke-width='2.2' stroke-linecap='round'/></g>";
  const cx = W * 0.28, cw = W * 0.44, cy = H * 0.12, ch = H * 0.76, dome = 13 * k;
  s += artPanel((d) => artCartouche(cx + d, cy + d, cw - 2 * d, ch - 2 * d, dome), 3.2 * k, P);
  s += "<g filter='url(#bev)' fill='none' stroke='url(#metal)' stroke-width='" + tpF(1.6 * k) + "' stroke-linecap='round'>"
    + "<path d='" + artScrolls(W / 2, cy - 1.5 * k, 26 * k, true) + "'/><path d='" + artScrolls(W / 2, cy + ch + 1.5 * k, 26 * k, false) + "'/></g>";
  return s;
}
// 2. filigree (אבנים שלמות): a white marble page, great filigree in the corners, a lobed panel
function artFiligreePage(W, H, P){
  const k = W / 170;
  const lobed = (d) => {
    const x = 34 * k + d, y = 44 * k + d, w = W - 68 * k - 2 * d, h = H - 88 * k - 2 * d, b = 16 * k;
    return "M" + tpF(x) + " " + tpF(y + b) + "C" + tpF(x) + " " + tpF(y + b * 0.2) + " " + tpF(x + w * 0.25) + " " + tpF(y + b * 0.6) + " " + tpF(x + w * 0.5) + " " + tpF(y - b * 0.9)
      + "C" + tpF(x + w * 0.75) + " " + tpF(y + b * 0.6) + " " + tpF(x + w) + " " + tpF(y + b * 0.2) + " " + tpF(x + w) + " " + tpF(y + b)
      + "V" + tpF(y + h - b) + "C" + tpF(x + w) + " " + tpF(y + h - b * 0.2) + " " + tpF(x + w * 0.75) + " " + tpF(y + h - b * 0.6) + " " + tpF(x + w * 0.5) + " " + tpF(y + h + b * 0.9)
      + "C" + tpF(x + w * 0.25) + " " + tpF(y + h - b * 0.6) + " " + tpF(x) + " " + tpF(y + h - b * 0.2) + " " + tpF(x) + " " + tpF(y + h - b) + "Z";
  };
  let s = "<defs>" + artFx(P) + "</defs><rect width='" + W + "' height='" + H + "' fill='" + P.page + "'/>"
    + "<rect width='" + W + "' height='" + H + "' filter='url(#cloud)'/>"
    + "<rect x='" + tpF(7 * k) + "' y='" + tpF(7 * k) + "' width='" + tpF(W - 14 * k) + "' height='" + tpF(H - 14 * k) + "' fill='none' stroke='url(#metal)' stroke-width='" + tpF(2.2 * k) + "' filter='url(#bev)'/>"
    + "<rect x='" + tpF(10.5 * k) + "' y='" + tpF(10.5 * k) + "' width='" + tpF(W - 21 * k) + "' height='" + tpF(H - 21 * k) + "' fill='none' stroke='" + P.mid + "' stroke-width='.35'/>";
  s += "<g filter='url(#bev)'>" + artFiligree(12 * k, 12 * k, 1, 1, 0.75 * k) + artFiligree(W - 12 * k, 12 * k, -1, 1, 0.75 * k)
    + artFiligree(12 * k, H - 12 * k, 1, -1, 0.75 * k) + artFiligree(W - 12 * k, H - 12 * k, -1, -1, 0.75 * k) + "</g>";
  s += "<path d='" + lobed(-4.5 * k) + "' fill='url(#metal)' filter='url(#sh)'/><path d='" + lobed(-4.5 * k) + "' fill='url(#metal)' filter='url(#bev)'/>"
    + "<path d='" + lobed(-1.5 * k) + "' fill='" + P.panel + "' stroke='" + P.lo + "' stroke-width='.3'/>"
    + "<path d='" + lobed(1.2 * k) + "' fill='" + P.page + "' stroke='" + P.mid + "' stroke-width='.5' filter='url(#sh)'/>";
  s += "<g filter='url(#bev)' fill='none' stroke='url(#metal)' stroke-width='" + tpF(1.7 * k) + "' stroke-linecap='round'>"
    + "<path d='" + artScrolls(W / 2, 33 * k, 40 * k, true) + "'/><path d='" + artScrolls(W / 2, H - 33 * k, 40 * k, false) + "'/></g>";
  return s;
}
// 3. damask columns (שמן המור): a fine double frame, leafy damask down both sides, a framed field
function artDamask(W, H, P){
  const k = W / 170, R = tpRng(21);
  const tile = 7 * k;
  let leaves = "";
  const leaf = (x, y, r, sc) => "<path transform='translate(" + tpF(x) + " " + tpF(y) + ") rotate(" + tpF(r) + ") scale(" + tpF(sc) + ")' d='M0 0C2 -2.6 6 -2.8 8 0C6 2.8 2 2.6 0 0Z'/>";
  for(let i = 0; i < 7; i++) leaves += leaf(R() * tile, R() * tile * 1.6, R() * 360, (0.32 + R() * 0.3) * k);
  const stems = "<path d='M" + tpF(tile * 0.5) + " 0C" + tpF(tile * 0.1) + " " + tpF(tile * 0.4) + " " + tpF(tile * 0.9) + " " + tpF(tile * 0.8) + " " + tpF(tile * 0.5) + " " + tpF(tile * 1.6) + "' fill='none' stroke='" + P.mid + "' stroke-width='.35'/>";
  const col = (x) => "<rect x='" + tpF(x) + "' y='" + tpF(14 * k) + "' width='" + tpF(22 * k) + "' height='" + tpF(H - 28 * k) + "' fill='url(#dm)'/>"
    + "<rect x='" + tpF(x) + "' y='" + tpF(14 * k) + "' width='" + tpF(22 * k) + "' height='" + tpF(H - 28 * k) + "' fill='none' stroke='" + P.mid + "' stroke-width='.6'/>";
  let s = "<defs>" + artFx(P) + "<pattern id='dm' width='" + tpF(tile) + "' height='" + tpF(tile * 1.6) + "' patternUnits='userSpaceOnUse'>"
    + "<rect width='" + tpF(tile) + "' height='" + tpF(tile * 1.6) + "' fill='" + P.page + "'/>" + stems
    + "<g fill='" + P.panel + "' stroke='" + P.mid + "' stroke-width='.18'>" + leaves + "</g></pattern></defs>"
    + "<rect width='" + W + "' height='" + H + "' fill='" + P.page + "'/>";
  for(const [d, w] of [[8, 1.1], [10, .3], [12.5, .6]])
    s += "<rect x='" + tpF(d * k) + "' y='" + tpF(d * k) + "' width='" + tpF(W - 2 * d * k) + "' height='" + tpF(H - 2 * d * k) + "' fill='none' stroke='" + P.lo + "' stroke-width='" + w + "'/>";
  s += col(14 * k) + col(W - 36 * k);
  const fx = 39 * k, fy = 16 * k, fw = W - 78 * k, fh = H - 32 * k;
  s += "<rect x='" + tpF(fx) + "' y='" + tpF(fy) + "' width='" + tpF(fw) + "' height='" + tpF(fh) + "' fill='none' stroke='url(#metal)' stroke-width='" + tpF(2.4 * k) + "' filter='url(#bev)'/>"
    + "<rect x='" + tpF(fx + 3 * k) + "' y='" + tpF(fy + 3 * k) + "' width='" + tpF(fw - 6 * k) + "' height='" + tpF(fh - 6 * k) + "' fill='none' stroke='" + P.mid + "' stroke-width='.35'/>";
  s += "<g filter='url(#bev)' fill='none' stroke='url(#metal)' stroke-width='" + tpF(1.3 * k) + "' stroke-linecap='round'>";
  for(const [x, y, sx, sy] of [[fx + 3 * k, fy + 3 * k, 1, 1], [fx + fw - 3 * k, fy + 3 * k, -1, 1], [fx + 3 * k, fy + fh - 3 * k, 1, -1], [fx + fw - 3 * k, fy + fh - 3 * k, -1, -1]])
    s += "<g transform='translate(" + tpF(x) + " " + tpF(y) + ") scale(" + tpF(sx * k) + " " + tpF(sy * k) + ")'><path d='" + tpPts(tpSpiral(5, 5, 3.6, Math.PI, 1.4, 1, true)) + "M8 1.5C11 1 13 2 14 4M1.5 8C1 11 2 13 4 14'/></g>";
  return s + "</g>";
}
// 4. modern (אהבה רבה): a tall bar of linked curls with fine rules, a sweeping flourish
function artModern(W, H, P){
  const k = W / 170, bx = 24 * k, top = 14 * k, bot = H - 14 * k, gap = 0.37 * H;
  let s = "<defs>" + artFx(P) + "<linearGradient id='bar' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='" + P.mid + "'/><stop offset='1' stop-color='" + P.hi + "'/></linearGradient>"
    + "<linearGradient id='fadeR' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='" + P.mid + "'/><stop offset='1' stop-color='" + P.mid + "' stop-opacity='0'/></linearGradient></defs>"
    + "<rect width='" + W + "' height='" + H + "' fill='" + P.page + "'/>";
  const seg = (y0, y1) => {
    let g = "<rect x='" + tpF(bx - 3.5 * k) + "' y='" + tpF(y0) + "' width='" + tpF(2.2 * k) + "' height='" + tpF(y1 - y0) + "' fill='url(#bar)' filter='url(#bev)'/>";
    for(let y = y0 + 3 * k; y < y1 - 3 * k; y += 6.2 * k)
      g += "<path d='" + tpPts(tpSpiral(bx + 1.6 * k, y, 2.2 * k, -Math.PI / 2, 1.2, 1, true)) + "' fill='none' stroke='" + P.lo + "' stroke-width='.35'/>";
    for(let i = 0; i < 9; i++) g += "<line x1='" + tpF(bx + (6 + i * 3.4) * k) + "' y1='" + tpF(y0) + "' x2='" + tpF(bx + (6 + i * 3.4) * k) + "' y2='" + tpF(y1) + "' stroke='" + P.mid + "' stroke-width='.22'/>";
    return g;
  };
  s += seg(top, H * 0.21) + seg(H * 0.21 + gap * 0.0 + 0.17 * H, bot);
  s += "<rect x='" + tpF(bx - 3.5 * k) + "' y='" + tpF(H * 0.385) + "' width='" + tpF(W * 0.5) + "' height='" + tpF(1.6 * k) + "' fill='url(#fadeR)'/>"
    + "<rect x='" + tpF(bx - 3.5 * k) + "' y='" + tpF(H * 0.205) + "' width='" + tpF(W * 0.3) + "' height='" + tpF(.8 * k) + "' fill='url(#fadeR)'/>";
  // the flourish: a long curl with a second, finer one beside it
  const fx = W * 0.84, fy = H * 0.17;
  const curl = (sc, w) => "<path d='M" + tpF(fx - 30 * sc * k) + " " + tpF(fy + 14 * sc * k) + "C" + tpF(fx - 12 * sc * k) + " " + tpF(fy + 22 * sc * k) + " " + tpF(fx + 14 * sc * k) + " " + tpF(fy + 12 * sc * k) + " " + tpF(fx + 10 * sc * k) + " " + tpF(fy - 4 * sc * k)
    + tpPts(tpSpiral(fx + 2 * sc * k, fy - 4 * sc * k, 8 * sc * k, 0, 1.3, -1, true)).replace(/^M/, "L") + "' fill='none' stroke='" + P.mid + "' stroke-width='" + w + "' stroke-linecap='round'/>";
  return s + "<g filter='url(#bev)'>" + curl(1, 2.2 * k) + curl(0.7, 1.2 * k) + "</g>";
}
// 5. arched window in a wall (וזאת ליהודה) — stone, parchment or leather
const artNoise = (id, freq, oct, rgb, alpha, seed) => "<filter id='" + id + "' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='" + freq
  + "' numOctaves='" + oct + "' seed='" + (seed || 3) + "'/><feColorMatrix values='0 0 0 0 " + rgb[0] + " 0 0 0 0 " + rgb[1] + " 0 0 0 0 " + rgb[2] + " 0 0 0 " + alpha + " 0'/></filter>";
function artWall(W, H, tone){
  const R = tpRng(7), rh = 13 * W / 170;
  let s = "<g stroke='" + tone.mortar + "' stroke-width='.9'>";
  for(let y = 0, row = 0; y < H; y += rh, row++){
    let x = row % 2 ? -11 * W / 170 : -2;
    while(x < W){
      const w = (17 + R() * 15) * W / 170, g = tone.lo + R() * (tone.hi - tone.lo);
      s += "<rect x='" + tpF(x) + "' y='" + tpF(y) + "' width='" + tpF(w) + "' height='" + tpF(rh) + "' rx='1.4' fill='rgb(" + tone.rgb.map(c => Math.round(c * g)).join(",") + ")'/>";
      x += w;
    }
  }
  return s + "</g><rect width='" + W + "' height='" + H + "' filter='url(#grain)'/><rect width='" + W + "' height='" + H + "' filter='url(#pits)'/>";
}
function artWindow(W, H, o){
  const x0 = o.x, x1 = W - o.x, y0 = o.y, r = (x1 - x0) / 2, bot = H + 5;
  const arch = (d) => "M" + tpF(x0 + d) + " " + bot + "V" + tpF(y0 + r) + "A" + tpF(r - d) + " " + tpF(r - d) + " 0 0 1 " + tpF(x1 - d) + " " + tpF(y0 + r) + "V" + bot + "Z";
  return "<path d='" + arch(0) + "' fill='" + o.rim + "' filter='url(#shadow)'/>"
    + "<path d='" + arch(0) + "' fill='url(#rimg)' filter='url(#bev)'/>"
    + "<path d='" + arch(o.rimW) + "' fill='url(#panel)' stroke='" + o.edge + "' stroke-width='.35'/>"
    + "<path d='" + arch(o.rimW + 2.2) + "' fill='none' stroke='" + o.dots + "' stroke-width='.75' stroke-linecap='round' stroke-dasharray='0 1.7'/>";
}
const artWallDefs = (o) => artFx(TP_PAL.silver)
  + artNoise("grain", ".75", 4, o.grain, o.grainA, 5) + artNoise("pits", ".09", 3, o.pits, o.pitsA, 11)
  + "<filter id='shadow' x='-20%' y='-20%' width='140%' height='140%'><feDropShadow dx='0' dy='1.2' stdDeviation='" + (o.shadow || 2.4) + "' flood-color='#000' flood-opacity='" + (o.shadowA || .45) + "'/></filter>"
  + "<linearGradient id='rimg' x1='0' y1='0' x2='1' y2='0'>" + o.rimStops + "</linearGradient>"
  + "<linearGradient id='panel' x1='0' y1='0' x2='0' y2='1'>" + o.panelStops + "</linearGradient>"
  + "<linearGradient id='fade' x1='0' y1='0' x2='0' y2='1'>" + (o.fadeStops || "<stop offset='0' stop-opacity='0'/>") + "</linearGradient>"
  + "<radialGradient id='vig' cx='50%' cy='45%' r='75%'><stop offset='.55' stop-color='#000' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='" + (o.vig || 0) + "'/></radialGradient>";
const artSwirl = (cx, cy, w, col) => "<path d='" + artScrolls(cx, cy, w, false) + "' fill='none' stroke='" + col + "' stroke-width='" + tpF(w / 30) + "' stroke-linecap='round' filter='url(#bev)'/>";
function artArchWall(W, H, kind){
  const k = W / 170;
  if(kind === "stone") return "<defs>" + artWallDefs({grain:[.35, .35, .35], grainA:.35, pits:[.3, .3, .3], pitsA:.18,
      rimStops:"<stop offset='0' stop-color='#d9d9db'/><stop offset='.5' stop-color='#ffffff'/><stop offset='1' stop-color='#cfcfd2'/>",
      panelStops:"<stop offset='0' stop-color='#f7f7f8'/><stop offset='1' stop-color='#e6e6e9'/>",
      fadeStops:"<stop offset='0' stop-color='#f2f2f2'/><stop offset='.2' stop-color='#f2f2f2'/><stop offset='.42' stop-color='#f2f2f2' stop-opacity='0'/>", shadowA:.35}) + "</defs>"
    + "<rect width='" + W + "' height='" + H + "' fill='#e9e9e9'/>" + artWall(W, H, {rgb:[214, 212, 206], lo:.82, hi:1.04, mortar:"#f4f4f2"})
    + "<rect width='" + W + "' height='" + H + "' fill='url(#fade)'/>"
    + artWindow(W, H, {x:W * 0.155, y:H * 0.075, rim:"#ffffff", rimW:4.2 * k, edge:"#c8c8cc", dots:"#ffffff"}) + artSwirl(W / 2, H * 0.5, 24 * k, "#b5b5b8");
  if(kind === "parchment") return "<defs>" + artWallDefs({grain:[.45, .3, .12], grainA:.28, pits:[.4, .25, .08], pitsA:.32,
      rimStops:"<stop offset='0' stop-color='#8a6a1f'/><stop offset='.22' stop-color='#f3d98b'/><stop offset='.5' stop-color='#b48a2c'/><stop offset='.78' stop-color='#f7e3a1'/><stop offset='1' stop-color='#7d5e17'/>",
      panelStops:"<stop offset='0' stop-color='#fbf5e6'/><stop offset='1' stop-color='#efe2c2'/>", vig:.38, shadowA:.4}) + "</defs>"
    + "<rect width='" + W + "' height='" + H + "' fill='#e6d2a4'/><rect width='" + W + "' height='" + H + "' filter='url(#pits)'/><rect width='" + W + "' height='" + H + "' filter='url(#grain)'/>"
    + "<rect width='" + W + "' height='" + H + "' fill='url(#vig)'/>"
    + artWindow(W, H, {x:W * 0.15, y:H * 0.07, rim:"#b48a2c", rimW:3.4 * k, edge:"#8a6a1f", dots:"#b48a2c"}) + artSwirl(W / 2, H * 0.5, 24 * k, "#c9a24a");
  return "<defs>" + artWallDefs({grain:[.12, .06, .03], grainA:.55, pits:[.05, .02, .01], pitsA:.45,
      rimStops:"<stop offset='0' stop-color='#7d5e17'/><stop offset='.25' stop-color='#f3d98b'/><stop offset='.5' stop-color='#a8801f'/><stop offset='.75' stop-color='#f7e3a1'/><stop offset='1' stop-color='#6e5214'/>",
      panelStops:"<stop offset='0' stop-color='#4a2616'/><stop offset='1' stop-color='#2e170d'/>", vig:.6, shadowA:.7, shadow:3}) + "</defs>"
    + "<rect width='" + W + "' height='" + H + "' fill='#3b1f13'/><rect width='" + W + "' height='" + H + "' filter='url(#pits)'/><rect width='" + W + "' height='" + H + "' filter='url(#grain)'/>"
    + "<rect width='" + W + "' height='" + H + "' fill='url(#vig)'/>"
    + "<rect x='7' y='7' width='" + (W - 14) + "' height='" + (H - 14) + "' fill='none' stroke='#c9a24a' stroke-width='.7'/>"
    + "<rect x='9' y='9' width='" + (W - 18) + "' height='" + (H - 18) + "' fill='none' stroke='#c9a24a' stroke-width='.25'/>"
    + artWindow(W, H, {x:W * 0.16, y:H * 0.08, rim:"#a8801f", rimW:3 * k, edge:"#5e440f", dots:"#d7b65e"}) + artSwirl(W / 2, H * 0.5, 24 * k, "#d7b65e");
}
// 6. wallpaper, frame and cartouche (כתבי האריז"ל): a grey swirl wallpaper, a white frame with
// silver rims and corner curls, inside it a grey cartouche crowned top and bottom, a label for the subtitle
function artWallpaperFrame(W, H, P){
  const k = W / 170, t = 10 * k;
  const curl = artScrolls(t / 2, t * 0.3, t * 0.8, false) + artScrolls(0, t * 0.8, t * 0.8, true) + artScrolls(t, t * 0.8, t * 0.8, true);
  let s = "<defs>" + artFx(P)
    + "<pattern id='wp' width='" + tpF(t) + "' height='" + tpF(t) + "' patternUnits='userSpaceOnUse'><rect width='" + tpF(t) + "' height='" + tpF(t) + "' fill='#d6d6d9'/>"
    + "<path d='" + curl + "' fill='none' stroke='#ffffff' stroke-width='.8' transform='translate(.25 .25)'/><path d='" + curl + "' fill='none' stroke='#b4b4b8' stroke-width='.4'/>"
    + "<g transform='rotate(180 " + tpF(t / 2) + " " + tpF(t / 2) + ") translate(0 " + tpF(t / 2) + ")'><path d='" + artScrolls(t / 2, 0, t * 0.5, true) + "' fill='none' stroke='#a9a9ad' stroke-width='.45'/></g></pattern>";
  const fx = 0.165 * W, fy = 0.13 * H, fw = W - 2 * fx, fh = H - 2 * fy;
  const cx = 0.27 * W, cy = 0.19 * H, cw = W - 2 * cx, ch = H - 2 * cy, dome = 9 * k;
  s += "<clipPath id='cart'><path d='" + artCartouche(cx + 3 * k, cy + 3 * k, cw - 6 * k, ch - 6 * k, dome) + "'/></clipPath></defs>"
    + "<rect width='" + W + "' height='" + H + "' fill='url(#wp)'/><rect width='" + W + "' height='" + H + "' filter='url(#cloud)'/>";
  const fr = (d) => artConcave(fx + d, fy + d, fw - 2 * d, fh - 2 * d, Math.max(1.5, 6 * k - d));
  s += "<path d='" + fr(0) + "' fill='#ffffff' filter='url(#sh)'/>"
    + "<path d='" + fr(0) + "' fill='none' stroke='url(#metal)' stroke-width='" + tpF(2.6 * k) + "' filter='url(#bev)'/>"
    + "<path d='" + fr(3.2 * k) + "' fill='none' stroke='" + P.mid + "' stroke-width='.35'/>"
    + "<path d='" + fr(5 * k) + "' fill='none' stroke='url(#metal)' stroke-width='" + tpF(1.3 * k) + "' filter='url(#bev)'/>";
  for(const [x, y, sx, sy] of [[fx, fy, 1, 1], [fx + fw, fy, -1, 1], [fx, fy + fh, 1, -1], [fx + fw, fy + fh, -1, -1]])
    s += "<g transform='translate(" + tpF(x) + " " + tpF(y) + ") scale(" + tpF(sx * k) + " " + tpF(sy * k) + ")'><path d='" + tpPts(tpSpiral(3, 3, 4.5, Math.PI * 1.25, 1.5, 1, true))
      + "M5 1C10 -.5 14 1 16 4M1 5C-.5 10 1 14 4 16' fill='none' stroke='" + P.lo + "' stroke-width='1.3' stroke-linecap='round'/></g>";
  const cart = (d) => artCartouche(cx + d, cy + d, cw - 2 * d, ch - 2 * d, dome);
  s += "<path d='" + cart(0) + "' fill='url(#metal)' filter='url(#sh)'/><path d='" + cart(0) + "' fill='url(#metal)' filter='url(#bev)'/>"
    + "<path d='" + cart(2.4 * k) + "' fill='url(#wp)'/>"
    + "<path d='" + cart(3 * k) + "' fill='none' stroke='" + P.lo + "' stroke-width='.35'/><path d='" + cart(4.6 * k) + "' fill='none' stroke='#ffffff' stroke-width='.6'/>";
  // crests: a white medallion with curls and a lily on the dome of the cartouche
  const crest = (y, up) => {
    const sg = up ? -1 : 1, c = W / 2;
    return "<ellipse cx='" + tpF(c) + "' cy='" + tpF(y) + "' rx='" + tpF(17 * k) + "' ry='" + tpF(6 * k) + "' fill='#ffffff' filter='url(#sh)'/>"
      + "<g filter='url(#bev)' fill='none' stroke='url(#metal)' stroke-width='" + tpF(1.5 * k) + "' stroke-linecap='round'>"
      + "<path d='" + artScrolls(c, y, 30 * k, up) + "'/></g>"
      + "<path d='M" + tpF(c) + " " + tpF(y + sg * k) + "C" + tpF(c - 3 * k) + " " + tpF(y - sg * 2 * k) + " " + tpF(c - 2 * k) + " " + tpF(y - sg * 6 * k) + " " + tpF(c) + " " + tpF(y - sg * 8 * k)
      + "C" + tpF(c + 2 * k) + " " + tpF(y - sg * 6 * k) + " " + tpF(c + 3 * k) + " " + tpF(y - sg * 2 * k) + " " + tpF(c) + " " + tpF(y + sg * k) + "Z' fill='url(#metal)' filter='url(#bev)'/>";
  };
  s += crest(cy + k, true) + crest(cy + ch - k, false);
  // the label for the subtitle, with curled ends
  const ly = 0.462 * H, lw = 58 * k, lh = 9 * k, L = W / 2 - lw / 2, R = W / 2 + lw / 2;
  s += "<rect x='" + tpF(L) + "' y='" + tpF(ly - lh / 2) + "' width='" + tpF(lw) + "' height='" + tpF(lh) + "' fill='#ffffff' stroke='" + P.mid + "' stroke-width='.4' filter='url(#sh)'/>"
    + "<g fill='none' stroke='" + P.lo + "' stroke-width='.45' stroke-linecap='round'>"
    + "<path d='" + tpPts(tpSpiral(L - 4 * k, ly, 2.6 * k, 0, 1.3, 1, true)) + "M" + tpF(L) + " " + tpF(ly) + "H" + tpF(L - 1.5 * k) + "'/>"
    + "<path d='" + tpPts(tpSpiral(R + 4 * k, ly, 2.6 * k, Math.PI, 1.3, -1, true)) + "M" + tpF(R) + " " + tpF(ly) + "H" + tpF(R + 1.5 * k) + "'/></g>";
  return s;
}
/* ------------------------------------- the Otzar gate: marble columns, curtain, cornice */
// Eli: "הדוגמאות ברמה נמוכה" — he pointed at the modern שערים in Otzar (משניות עטרת שלמה,
// ספר הרוקח): a classical gate of veined marble columns with capitals and bases under a
// moulded cornice, a parochet drawn up in swags with tassels, or a silver moulding of many
// steps on marble. Drawn with real light: cylinder shading on every column, veins from
// noise, a dropped shadow behind every part.
const artMarbleDefs = (id, seed, tone) => "<filter id='" + id + "' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>"
  + "<feTurbulence type='fractalNoise' baseFrequency='.018 .06' numOctaves='5' seed='" + seed + "' result='n'/>"
  + "<feColorMatrix in='n' type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1.6 1.6 0 0 -1.15' result='a'/>"
  + "<feComponentTransfer in='a' result='v'><feFuncA type='table' tableValues='0 .03 .38 .05 0 0 .2 .02 0'/></feComponentTransfer>"
  + "<feFlood flood-color='" + (tone || "#6f6f74") + "'/><feComposite in2='v' operator='in' result='veins'/>"
  + "<feTurbulence type='fractalNoise' baseFrequency='.008' numOctaves='3' seed='" + (seed + 7) + "' result='c'/>"
  + "<feColorMatrix in='c' type='matrix' values='0 0 0 0 .55 0 0 0 0 .55 0 0 0 0 .57 0 0 0 .35 0' result='cl'/>"
  + "<feMerge><feMergeNode in='cl'/><feMergeNode in='veins'/></feMerge></filter>";
// a column from y0 (top of capital) to y1 (foot of base), centred at cx, shaft width w
function artColumn(cx, y0, y1, w, k){
  const cap = 15 * k, base = 16 * k, sx = cx - w / 2, st = y0 + cap, sb = y1 - base;
  let s = "<g filter='url(#sh)'>";
  s += "<rect x='" + tpF(cx - w * 0.82) + "' y='" + tpF(y1 - 6 * k) + "' width='" + tpF(w * 1.64) + "' height='" + tpF(6 * k) + "' fill='url(#colG)'/>"
    + "<rect x='" + tpF(cx - w * 0.82) + "' y='" + tpF(y1 - 6 * k) + "' width='" + tpF(w * 1.64) + "' height='" + tpF(6 * k) + "' filter='url(#mbC)'/>"
    + "<rect x='" + tpF(cx - w * 0.72) + "' y='" + tpF(y1 - 10.5 * k) + "' width='" + tpF(w * 1.44) + "' height='" + tpF(4.5 * k) + "' rx='" + tpF(2.2 * k) + "' fill='url(#colG)'/>"
    + "<rect x='" + tpF(cx - w * 0.62) + "' y='" + tpF(y1 - 14 * k) + "' width='" + tpF(w * 1.24) + "' height='" + tpF(3.5 * k) + "' rx='" + tpF(1.7 * k) + "' fill='url(#colG)'/>"
    + "<rect x='" + tpF(sx - 1.2 * k) + "' y='" + tpF(sb - 2 * k) + "' width='" + tpF(w + 2.4 * k) + "' height='" + tpF(2 * k) + "' fill='url(#colG)'/>";
  const t = w * 0.06, sh = "M" + tpF(sx + t) + " " + tpF(st) + "H" + tpF(sx + w - t) + "L" + tpF(sx + w) + " " + tpF(sb) + "H" + tpF(sx) + "Z";
  s += "<path d='" + sh + "' fill='#f4f4f5'/><path d='" + sh + "' filter='url(#mbC)'/><path d='" + sh + "' fill='url(#cyl)'/>";
  for(let i = 1; i < 7; i++){
    const f = i / 7, xa = sx + t + (w - 2 * t) * f, xb = sx + w * f;
    s += "<path d='M" + tpF(xa) + " " + tpF(st + 3 * k) + "L" + tpF(xb) + " " + tpF(sb - 3 * k) + "' stroke='#ffffff' stroke-width='" + tpF(.55 * k) + "' opacity='.75'/>"
      + "<path d='M" + tpF(xa + .55 * k) + " " + tpF(st + 3 * k) + "L" + tpF(xb + .55 * k) + " " + tpF(sb - 3 * k) + "' stroke='#8d8d92' stroke-width='" + tpF(.3 * k) + "' opacity='.6'/>";
  }
  s += "<path d='" + sh + "' fill='none' stroke='#86868b' stroke-width='.35'/>";
  const cy = st;
  s += "<rect x='" + tpF(sx - .6 * k) + "' y='" + tpF(cy - 2.2 * k) + "' width='" + tpF(w + 1.2 * k) + "' height='" + tpF(2.2 * k) + "' fill='url(#colG)'/>";
  const bell = "M" + tpF(sx) + " " + tpF(cy - 2.2 * k) + "C" + tpF(sx - 1 * k) + " " + tpF(cy - 7 * k) + " " + tpF(sx - 4 * k) + " " + tpF(cy - 10 * k) + " " + tpF(sx - 5 * k) + " " + tpF(cy - 11.5 * k)
    + "H" + tpF(sx + w + 5 * k) + "C" + tpF(sx + w + 4 * k) + " " + tpF(cy - 10 * k) + " " + tpF(sx + w + 1 * k) + " " + tpF(cy - 7 * k) + " " + tpF(sx + w) + " " + tpF(cy - 2.2 * k) + "Z";
  s += "<path d='" + bell + "' fill='url(#colG)'/>";
  for(let i = 0; i < 5; i++){
    const lx = sx + w * (i + .5) / 5, lh = (i % 2 ? 6.5 : 8.5) * k, b0 = cy - 2.2 * k;
    s += "<path d='M" + tpF(lx) + " " + tpF(b0) + "C" + tpF(lx - 2.4 * k) + " " + tpF(b0 - lh * .5) + " " + tpF(lx - 1.2 * k) + " " + tpF(b0 - lh) + " " + tpF(lx + .6 * k) + " " + tpF(b0 - lh)
      + "C" + tpF(lx + 1.6 * k) + " " + tpF(b0 - lh * .6) + " " + tpF(lx + 2 * k) + " " + tpF(b0 - lh * .3) + " " + tpF(lx) + " " + tpF(b0) + "Z' fill='#e6e6e8' stroke='#7c7c81' stroke-width='.3'/>";
  }
  for(const sg of [-1, 1]){
    const vx = cx + sg * (w / 2 + 3.2 * k), vy = cy - 9.5 * k;
    s += "<path d='" + tpPts(tpSpiral(vx, vy, 2.6 * k, sg < 0 ? 0 : Math.PI, 1.6, sg, true)) + "' fill='none' stroke='#6e6e73' stroke-width='" + tpF(.55 * k) + "'/>";
  }
  s += "<rect x='" + tpF(sx - 6.5 * k) + "' y='" + tpF(cy - cap) + "' width='" + tpF(w + 13 * k) + "' height='" + tpF(3.5 * k) + "' fill='url(#colG)' stroke='#86868b' stroke-width='.3'/>";
  return s + "</g>";
}
// a broken pediment above the cornice: two rising arms ending in scrolls, an acanthus between
function artPediment(x0, x1, y, k){
  const c = (x0 + x1) / 2, h = 16 * k, gap = 12 * k;
  let s = "<g filter='url(#sh)'>";
  for(const sg of [-1, 1]){
    const e = sg < 0 ? x0 : x1, i = c + sg * gap;
    const arm = "M" + tpF(e) + " " + tpF(y) + "L" + tpF(i) + " " + tpF(y - h) + "L" + tpF(i) + " " + tpF(y - h + 5 * k) + "L" + tpF(e + -sg * 6 * k) + " " + tpF(y) + "Z";
    s += "<path d='" + arm + "' fill='url(#bandG)' stroke='#86868b' stroke-width='.3'/>"
      + "<path d='M" + tpF(e + -sg * 3 * k) + " " + tpF(y - 1.6 * k) + "L" + tpF(i) + " " + tpF(y - h + 2.6 * k) + "' stroke='#ffffff' stroke-width='.6'/>"
      + "<path d='" + tpPts(tpSpiral(i - sg * 2.5 * k, y - h + 4.5 * k, 4.2 * k, sg < 0 ? Math.PI * 1.5 : -Math.PI / 2, 1.6, -sg, true)) + "' fill='none' stroke='url(#colG)' stroke-width='" + tpF(1.8 * k) + "' stroke-linecap='round' filter='url(#bev)'/>";
  }
  return s + "</g>" + artAcanthus(c, y - 1 * k, 0.8 * k);
}
function artPedestal(cx, y0, y1, w, k){
  return "<g filter='url(#sh)'><rect x='" + tpF(cx - w / 2) + "' y='" + tpF(y0) + "' width='" + tpF(w) + "' height='" + tpF(y1 - y0) + "' fill='#efeff0'/>"
    + "<rect x='" + tpF(cx - w / 2) + "' y='" + tpF(y0) + "' width='" + tpF(w) + "' height='" + tpF(y1 - y0) + "' filter='url(#mbC)'/>"
    + "<rect x='" + tpF(cx - w / 2 - 1.5 * k) + "' y='" + tpF(y0) + "' width='" + tpF(w + 3 * k) + "' height='" + tpF(2.4 * k) + "' fill='url(#bandG)'/>"
    + "<rect x='" + tpF(cx - w / 2 - 2 * k) + "' y='" + tpF(y1 - 3 * k) + "' width='" + tpF(w + 4 * k) + "' height='" + tpF(3 * k) + "' fill='url(#bandG)'/>"
    + "<rect x='" + tpF(cx - w / 2 + 2.5 * k) + "' y='" + tpF(y0 + 4.5 * k) + "' width='" + tpF(w - 5 * k) + "' height='" + tpF(y1 - y0 - 9.5 * k) + "' fill='none' stroke='#8a8a8f' stroke-width='.4'/></g>";
}
// the cornice across the top: architrave, marble frieze, dentils, crown moulding
function artCornice(x0, x1, y, k){
  const w = x1 - x0;
  let s = "<g filter='url(#sh)'>"
    + "<rect x='" + tpF(x0) + "' y='" + tpF(y + 14 * k) + "' width='" + tpF(w) + "' height='" + tpF(5 * k) + "' fill='url(#bandG)'/>"
    + "<rect x='" + tpF(x0) + "' y='" + tpF(y + 6.5 * k) + "' width='" + tpF(w) + "' height='" + tpF(7.5 * k) + "' fill='#f1f1f2'/>"
    + "<rect x='" + tpF(x0) + "' y='" + tpF(y + 6.5 * k) + "' width='" + tpF(w) + "' height='" + tpF(7.5 * k) + "' filter='url(#mbC)'/>"
    + "<rect x='" + tpF(x0 - 3 * k) + "' y='" + tpF(y + 3 * k) + "' width='" + tpF(w + 6 * k) + "' height='" + tpF(3.5 * k) + "' fill='url(#bandG)'/>"
    + "<path d='M" + tpF(x0 - 7 * k) + " " + tpF(y + 3 * k) + "H" + tpF(x1 + 7 * k) + "L" + tpF(x1 + 4 * k) + " " + tpF(y - 1.5 * k) + "H" + tpF(x0 - 4 * k) + "Z' fill='url(#bandG)'/>"
    + "<rect x='" + tpF(x0 - 7 * k) + "' y='" + tpF(y - 3.5 * k) + "' width='" + tpF(w + 14 * k) + "' height='" + tpF(2 * k) + "' fill='url(#colG)'/></g>";
  for(let x = x0 + 1.5 * k; x < x1 - 1.5 * k; x += 3.4 * k)
    s += "<rect x='" + tpF(x) + "' y='" + tpF(y + 3.3 * k) + "' width='" + tpF(1.8 * k) + "' height='" + tpF(2.6 * k) + "' fill='#ffffff' stroke='#8a8a8f' stroke-width='.22'/>";
  return s + "<path d='M" + tpF(x0) + " " + tpF(y + 16.5 * k) + "H" + tpF(x1) + "' stroke='#ffffff' stroke-width='.5'/>";
}
// a parochet drawn up in two swags between x0 and x1, hanging from y, tails at the sides
function artCurtain(x0, x1, y, k, deep){
  const n = 2, sw = (x1 - x0) / n, d = deep * k;
  let s = "<g filter='url(#sh)'>";
  for(const sg of [-1, 1]){
    const ex = sg < 0 ? x0 : x1, ix = ex - sg * 14 * k;
    s += "<path d='M" + tpF(ex) + " " + tpF(y) + "C" + tpF(ix) + " " + tpF(y + 40 * k) + " " + tpF(ex - sg * 4 * k) + " " + tpF(y + 80 * k) + " " + tpF(ex - sg * 9 * k) + " " + tpF(y + 140 * k)
      + "L" + tpF(ex + sg * 2 * k) + " " + tpF(y + 136 * k) + "C" + tpF(ex + sg * 1 * k) + " " + tpF(y + 70 * k) + " " + tpF(ex + sg * 2 * k) + " " + tpF(y + 30 * k) + " " + tpF(ex + sg * 2 * k) + " " + tpF(y) + "Z' fill='url(#drape)' stroke='#8a8a8f' stroke-width='.3'/>";
    for(let i = 1; i < 4; i++)
      s += "<path d='M" + tpF(ex - sg * i * 2.4 * k) + " " + tpF(y + 2 * k) + "C" + tpF(ix + sg * i * 1.5 * k) + " " + tpF(y + 40 * k) + " " + tpF(ex - sg * (4 + i) * k) + " " + tpF(y + 80 * k) + " " + tpF(ex - sg * (7 + i * .4) * k) + " " + tpF(y + 133 * k) + "' fill='none' stroke='#9c9ca1' stroke-width='.35'/>";
  }
  for(let i = 0; i < n; i++){
    const a = x0 + i * sw, b = a + sw, m = (a + b) / 2;
    s += "<path d='M" + tpF(a) + " " + tpF(y) + "Q" + tpF(m) + " " + tpF(y + d * 2) + " " + tpF(b) + " " + tpF(y) + "Q" + tpF(m) + " " + tpF(y + d * 0.9) + " " + tpF(a) + " " + tpF(y) + "Z' fill='url(#drape)' stroke='#88888d' stroke-width='.35'/>";
    for(let f = 1; f < 10; f++)
      s += "<path d='M" + tpF(a + f * .5 * k) + " " + tpF(y + .4 * k) + "Q" + tpF(m) + " " + tpF(y + d * (.95 + f * .11)) + " " + tpF(b - f * .5 * k) + " " + tpF(y + .4 * k) + "' fill='none' stroke='" + (f % 2 ? "#ffffff" : "#9a9a9f") + "' stroke-width='" + tpF((f % 2 ? 1.1 : .5) * k) + "' opacity='" + (f % 2 ? .85 : .6) + "'/>";
    for(let t = .06; t < .95; t += .028){
      const px = (1 - t) * (1 - t) * a + 2 * (1 - t) * t * m + t * t * b, py = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * (y + d * 2) + t * t * y;
      s += "<path d='M" + tpF(px) + " " + tpF(py - .6 * k) + "v" + tpF(2.4 * k) + "' stroke='#7f7f84' stroke-width='.3'/>";
    }
  }
  for(let i = 0; i <= n; i++){
    const tx = x0 + i * sw, ty = y + (i === 0 || i === n ? 6 : 3) * k;
    s += "<path d='M" + tpF(tx) + " " + tpF(ty - 3 * k) + "v" + tpF(9 * k) + "' stroke='#7a7a7f' stroke-width='.5'/>"
      + "<ellipse cx='" + tpF(tx) + "' cy='" + tpF(ty + 6 * k) + "' rx='" + tpF(2 * k) + "' ry='" + tpF(2.4 * k) + "' fill='url(#colG)'/>"
      + "<path d='M" + tpF(tx - 2.6 * k) + " " + tpF(ty + 17 * k) + "L" + tpF(tx - 1.6 * k) + " " + tpF(ty + 8 * k) + "H" + tpF(tx + 1.6 * k) + "L" + tpF(tx + 2.6 * k) + " " + tpF(ty + 17 * k) + "Z' fill='url(#colG)' stroke='#7a7a7f' stroke-width='.25'/>";
    for(let j = -2; j <= 2; j++) s += "<path d='M" + tpF(tx + j * .9 * k) + " " + tpF(ty + 9 * k) + "L" + tpF(tx + j * 1.2 * k) + " " + tpF(ty + 16.5 * k) + "' stroke='#8d8d92' stroke-width='.22'/>";
  }
  return s + "</g>";
}
// a silver moulding of several steps (the frame of ספר הרוקח) at inset o
function artMoulding(W, H, o, k){
  const step = (d, fill, sw) => "<rect x='" + tpF(o + d) + "' y='" + tpF(o + d) + "' width='" + tpF(W - 2 * (o + d)) + "' height='" + tpF(H - 2 * (o + d)) + "' fill='none' stroke='" + fill + "' stroke-width='" + tpF(sw) + "'/>";
  let s = "<g filter='url(#sh)'>" + step(2.2 * k, "url(#bandG)", 4.4 * k) + "</g>"
    + step(.4 * k, "#ffffff", .5) + step(4.1 * k, "#7e7e83", .35)
    + step(6.4 * k, "url(#bandG)", 2.2 * k) + step(8 * k, "#ffffff", .45)
    + step(10 * k, "url(#bandG)", 2.8 * k) + step(11.7 * k, "#6f6f74", .35);
  let wv = "";
  for(let x = o + 10 * k; x < W - o - 10 * k; x += 4 * k)
    wv += "<path d='" + tpPts(tpSpiral(x, o + 6.4 * k, .9 * k, 0, 1, 1, true)) + "'/><path d='" + tpPts(tpSpiral(x, H - o - 6.4 * k, .9 * k, Math.PI, 1, 1, true)) + "'/>";
  for(let y = o + 10 * k; y < H - o - 10 * k; y += 4 * k)
    wv += "<path d='" + tpPts(tpSpiral(o + 6.4 * k, y, .9 * k, Math.PI / 2, 1, 1, true)) + "'/><path d='" + tpPts(tpSpiral(W - o - 6.4 * k, y, .9 * k, -Math.PI / 2, 1, 1, true)) + "'/>";
  s += "<g fill='none' stroke='#6c6c71' stroke-width='.28'>" + wv + "</g>";
  for(const [x, y] of [[o + 6.4 * k, o + 6.4 * k], [W - o - 6.4 * k, o + 6.4 * k], [o + 6.4 * k, H - o - 6.4 * k], [W - o - 6.4 * k, H - o - 6.4 * k]])
    s += "<rect x='" + tpF(x - 4.5 * k) + "' y='" + tpF(y - 4.5 * k) + "' width='" + tpF(9 * k) + "' height='" + tpF(9 * k) + "' fill='url(#colG)' stroke='#76767b' stroke-width='.3' filter='url(#bev)'/>"
      + "<circle cx='" + tpF(x) + "' cy='" + tpF(y) + "' r='" + tpF(2.4 * k) + "' fill='none' stroke='#6c6c71' stroke-width='.45'/>";
  return s;
}
// the gate of "יגל לבי": pilasters and an arched crown of buttoned (tufted) leather, edged
// with twisted rope, under a silver acanthus crest, on marble
const artQuiltDefs = (k) => {
  const t = 12 * k;
  return "<radialGradient id='tuft' cx='.42' cy='.38' r='.62'><stop offset='0' stop-color='#f2f2f4'/><stop offset='.45' stop-color='#b9b9be'/><stop offset='.85' stop-color='#77777d'/><stop offset='1' stop-color='#4c4c51'/></radialGradient>"
    + "<pattern id='quilt' width='" + tpF(t) + "' height='" + tpF(t) + "' patternUnits='userSpaceOnUse'><rect width='" + tpF(t) + "' height='" + tpF(t) + "' fill='#7a7a80'/>"
    + "<path d='M" + tpF(t / 2) + " 0L" + tpF(t) + " " + tpF(t / 2) + "L" + tpF(t / 2) + " " + tpF(t) + "L0 " + tpF(t / 2) + "Z' fill='url(#tuft)'/>"
    + "<path d='M0 0L" + tpF(t) + " " + tpF(t) + "M" + tpF(t) + " 0L0 " + tpF(t) + "' stroke='#2f2f33' stroke-width='" + tpF(.45 * k) + "'/>"
    + "<circle cx='0' cy='0' r='" + tpF(.9 * k) + "' fill='#e8e8ea' stroke='#3c3c41' stroke-width='.25'/><circle cx='" + tpF(t) + "' cy='0' r='" + tpF(.9 * k) + "' fill='#e8e8ea' stroke='#3c3c41' stroke-width='.25'/><circle cx='0' cy='" + tpF(t) + "' r='" + tpF(.9 * k) + "' fill='#e8e8ea' stroke='#3c3c41' stroke-width='.25'/><circle cx='" + tpF(t) + "' cy='" + tpF(t) + "' r='" + tpF(.9 * k) + "' fill='#e8e8ea' stroke='#3c3c41' stroke-width='.25'/>"
    + "<circle cx='" + tpF(t / 2) + "' cy='" + tpF(t / 2) + "' r='" + tpF(.9 * k) + "' fill='#e8e8ea' stroke='#3c3c41' stroke-width='.25'/></pattern>";
};
const artRope = (d, k) => "<path d='" + d + "' fill='none' stroke='#6f6f74' stroke-width='" + tpF(2.6 * k) + "'/>"
  + "<path d='" + d + "' fill='none' stroke='url(#bandG)' stroke-width='" + tpF(2 * k) + "'/>"
  + "<path d='" + d + "' fill='none' stroke='#ffffff' stroke-width='" + tpF(1.4 * k) + "' stroke-dasharray='" + tpF(.9 * k) + " " + tpF(1.1 * k) + "' opacity='.9'/>"
  + "<path d='" + d + "' fill='none' stroke='#7c7c81' stroke-width='" + tpF(1.9 * k) + "' stroke-dasharray='" + tpF(.25 * k) + " " + tpF(1.75 * k) + "'/>";
// a silver acanthus spray, centred at cx, its foot on y, sc = size
function artAcanthus(cx, y, sc){
  let s = "<g filter='url(#bev)' fill='url(#colG)' stroke='#6c6c71' stroke-width='.3'>";
  const leaf = (ang, len, wd) => {
    const a = ang * Math.PI / 180, ex = cx + Math.sin(a) * len, ey = y - Math.cos(a) * len;
    const nx = Math.cos(a) * wd, ny = Math.sin(a) * wd;
    const mx = cx + Math.sin(a) * len * .5, my = y - Math.cos(a) * len * .5;
    const tipx = ex + Math.sin(a + (ang > 0 ? .9 : -.9)) * len * .18, tipy = ey - Math.cos(a + (ang > 0 ? .9 : -.9)) * len * .18;
    return "<path d='M" + tpF(cx) + " " + tpF(y) + "Q" + tpF(mx + nx) + " " + tpF(my + ny) + " " + tpF(ex) + " " + tpF(ey)
      + "Q" + tpF(tipx) + " " + tpF(tipy) + " " + tpF(ex - nx * .3) + " " + tpF(ey - ny * .3)
      + "Q" + tpF(mx - nx) + " " + tpF(my - ny) + " " + tpF(cx) + " " + tpF(y) + "Z'/>"
      + "<path d='M" + tpF(cx) + " " + tpF(y) + "Q" + tpF(mx) + " " + tpF(my) + " " + tpF(ex) + " " + tpF(ey) + "' fill='none' stroke='#ffffff' stroke-width='.35'/>";
  };
  for(const [ang, len, wd] of [[-78, 15, 2.6], [78, 15, 2.6], [-55, 17, 3], [55, 17, 3], [-30, 19, 3.2], [30, 19, 3.2], [-10, 21, 3], [10, 21, 3], [0, 23, 2.2]])
    s += leaf(ang, len * sc, wd * sc);
  // the curled scrolls running out to both sides
  for(const sg of [-1, 1])
    s += "<path d='" + tpPts(tpSpiral(cx + sg * 20 * sc, y - 2 * sc, 4.5 * sc, sg < 0 ? 0 : Math.PI, 1.5, sg, true))
      + "M" + tpF(cx + sg * 4 * sc) + " " + tpF(y) + "C" + tpF(cx + sg * 10 * sc) + " " + tpF(y + 3 * sc) + " " + tpF(cx + sg * 22 * sc) + " " + tpF(y + 4 * sc) + " " + tpF(cx + sg * 25 * sc) + " " + tpF(y - 2 * sc)
      + "' fill='none' stroke='url(#colG)' stroke-width='" + tpF(2 * sc) + "' stroke-linecap='round'/>";
  return s + "</g>";
}
function artQuiltGate(W, H, k){
  const px = 12 * k, pw = 20 * k, top = 24 * k, bandH = 30 * k, foot = H - 10 * k;
  const ix = px + pw, iw = W - 2 * ix, ay = top + bandH + 14 * k;
  let s = "";
  // the crown: a band of quilting under a rounded top, open at the bottom by an arch
  const crown = "M" + tpF(px - 3 * k) + " " + tpF(top + 6 * k) + "Q" + tpF(W / 2) + " " + tpF(top - 6 * k) + " " + tpF(W - px + 3 * k) + " " + tpF(top + 6 * k)
    + "V" + tpF(ay + 10 * k) + "H" + tpF(W - ix) + "V" + tpF(ay) + "Q" + tpF(W / 2) + " " + tpF(top + bandH - 8 * k) + " " + tpF(ix) + " " + tpF(ay) + "V" + tpF(ay + 10 * k) + "H" + tpF(px - 3 * k) + "Z";
  s += "<path d='" + crown + "' fill='url(#quilt)' filter='url(#sh)'/>";
  const pil = (x) => "<rect x='" + tpF(x) + "' y='" + tpF(ay + 10 * k) + "' width='" + tpF(pw) + "' height='" + tpF(foot - ay - 22 * k) + "' fill='url(#quilt)' filter='url(#sh)'/>";
  s += pil(px) + pil(W - px - pw);
  // the white opening, the ropes along every edge
  s += "<path d='M" + tpF(ix) + " " + tpF(foot - 12 * k) + "V" + tpF(ay) + "Q" + tpF(W / 2) + " " + tpF(top + bandH - 8 * k) + " " + tpF(W - ix) + " " + tpF(ay) + "V" + tpF(foot - 12 * k) + "Z' fill='#ffffff' opacity='.94'/>";
  s += artRope("M" + tpF(px - 3 * k) + " " + tpF(top + 6 * k) + "Q" + tpF(W / 2) + " " + tpF(top - 6 * k) + " " + tpF(W - px + 3 * k) + " " + tpF(top + 6 * k), k)
    + artRope("M" + tpF(ix) + " " + tpF(foot - 12 * k) + "V" + tpF(ay) + "Q" + tpF(W / 2) + " " + tpF(top + bandH - 8 * k) + " " + tpF(W - ix) + " " + tpF(ay) + "V" + tpF(foot - 12 * k), k)
    + artRope("M" + tpF(px) + " " + tpF(ay + 10 * k) + "V" + tpF(foot - 12 * k) + "M" + tpF(W - px) + " " + tpF(ay + 10 * k) + "V" + tpF(foot - 12 * k), k);
  // capitals and bases of the pilasters, a cornice under the crown
  for(const x of [px, W - px - pw])
    s += "<rect x='" + tpF(x - 3 * k) + "' y='" + tpF(ay + 6 * k) + "' width='" + tpF(pw + 6 * k) + "' height='" + tpF(5 * k) + "' fill='url(#bandG)' filter='url(#sh)'/>"
      + "<rect x='" + tpF(x - 4 * k) + "' y='" + tpF(foot - 12 * k) + "' width='" + tpF(pw + 8 * k) + "' height='" + tpF(12 * k) + "' fill='url(#colG)' filter='url(#sh)'/>"
      + "<rect x='" + tpF(x - 4 * k) + "' y='" + tpF(foot - 12 * k) + "' width='" + tpF(pw + 8 * k) + "' height='" + tpF(12 * k) + "' filter='url(#mbC)'/>";
  s += artAcanthus(W / 2, top + 4 * k, 1.05 * k);
  // the scroll brackets where the arch meets the pilasters
  for(const sg of [-1, 1]){
    const x = sg < 0 ? ix + 2 * k : W - ix - 2 * k;
    s += "<path d='" + tpPts(tpSpiral(x + sg * -5 * k, ay + 2 * k, 3.4 * k, sg < 0 ? Math.PI : 0, 1.5, -sg, true)) + "M" + tpF(x) + " " + tpF(ay - 6 * k) + "C" + tpF(x + -sg * 2 * k) + " " + tpF(ay - 2 * k) + " " + tpF(x + -sg * 6 * k) + " " + tpF(ay - 2 * k) + " " + tpF(x + -sg * 8 * k) + " " + tpF(ay + 1 * k)
      + "' fill='none' stroke='url(#colG)' stroke-width='" + tpF(1.6 * k) + "' stroke-linecap='round' filter='url(#bev)'/>";
  }
  return s;
}
const artGateDefs = () => artMarbleDefs("mbC", 3, "#6a6a70") + artMarbleDefs("mbB", 17, "#a2a2a8")
  + "<linearGradient id='cyl' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#000' stop-opacity='.32'/><stop offset='.28' stop-color='#fff' stop-opacity='.55'/>"
  + "<stop offset='.42' stop-color='#fff' stop-opacity='.1'/><stop offset='.8' stop-color='#000' stop-opacity='.16'/><stop offset='1' stop-color='#000' stop-opacity='.42'/></linearGradient>"
  + "<linearGradient id='colG' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#a4a4a9'/><stop offset='.3' stop-color='#fafafa'/><stop offset='.55' stop-color='#dcdcdf'/><stop offset='1' stop-color='#8e8e93'/></linearGradient>"
  + "<linearGradient id='bandG' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fdfdfd'/><stop offset='.45' stop-color='#d2d2d5'/><stop offset='.6' stop-color='#f1f1f2'/><stop offset='1' stop-color='#97979c'/></linearGradient>"
  + "<linearGradient id='folds' x1='0' y1='0' x2='" + tpF(5) + "' y2='0' gradientUnits='userSpaceOnUse' spreadMethod='repeat'><stop offset='0' stop-color='#000' stop-opacity='.16'/><stop offset='.45' stop-color='#fff' stop-opacity='.35'/><stop offset='1' stop-color='#000' stop-opacity='.16'/></linearGradient>"
  + "<linearGradient id='drape' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f5f5f6'/><stop offset='.6' stop-color='#dedee1'/><stop offset='1' stop-color='#bdbdc2'/></linearGradient>";
/* ------------------------------------------------ שער from parts (a "recipe") */
// Eli: "20 דוגמאות מרהיבות ... ושהסטודיו יתאים לזה". Every rich שער is a recipe of parts —
// background, frame, centre panel, ornament, label, title look — all in light grey like the
// examples he sent. The studio can swap any part of the picture without touching the words.
const TP_PARTS = {
  bg:[["white", "לבן נקי"], ["cloud", "לבן עם עננות"], ["linen", "נייר מחוספס"], ["damask", "טפט מסולסל"], ["stone", "אבן ירושלמית"], ["marble", "שיש"]],
  frame:[["none", "בלי מסגרת"], ["lines", "קווים דקים"], ["concave", "מסגרת כסף מסולסלת"], ["white", "מסגרת לבנה עם שוליים"], ["filigree", "פיליגרן בפינות"], ["columns", "עמודי עלים"], ["bar", "פס תלתלים (מודרני)"], ["gate", "שער עמודי שיש"], ["gatecurtain", "עמודי שיש ופרוכת"], ["moulding", "מסגרת כסף מדורגת"], ["quilt", "קשת מרופדת וחבל שזור"]],
  panel:[["none", "בלי"], ["cartouche", "קרטוש"], ["lobed", "קרטוש מעוגל"], ["arch", "חלון קשת"], ["notched", "מלבן עם פינות"], ["oval", "אליפסה"]],
  fill:[["white", "לבן"], ["tex", "אפור מרקם"], ["damask", "טפט"]],
  orn:[["none", "בלי"], ["crest", "סמל למעלה ולמטה"], ["scrolls", "סלסולים"]],
  width:[["n", "צר"], ["w", "רחב"]],
};
const TP_TITLE_LOOK = {black:"שחור", edge:"שחור עם שוליים לבנים", emboss:"אותיות כסף בולטות"};
// the panel box on a 170×240 page
function tpRecipeBox(R){
  const w = R.width === "w" ? 104 : 80;
  if(R.frame === "gate" || R.frame === "gatecurtain"){
    const top = R.frame === "gatecurtain" ? 84 : 60;
    return {x:43, y:top, w:84, h:214 - top};
  }
  if(R.frame === "quilt") return {x:36, y:84, w:98, h:132};
  if(R.frame === "moulding" && R.panel === "none") return {x:30, y:34, w:110, h:172};
  if(R.panel === "none") return {x:(170 - (R.frame === "bar" ? 120 : 112)) / 2 + (R.frame === "bar" ? 12 : 0), y:30, w:R.frame === "bar" ? 120 : 112, h:180};
  if(R.panel === "arch") return {x:(170 - w - 12) / 2, y:22, w:w + 12, h:200};
  if(R.panel === "oval") return {x:(170 - w - 20) / 2, y:28, w:w + 20, h:184};
  return {x:(170 - w) / 2, y:R.frame === "white" ? 42 : 30, w, h:R.frame === "white" ? 156 : 180};
}
function tpRecipeArt(W, H, R){
  const P = TP_PAL.silver, k = W / 170, ky = H / 240;
  const B0 = tpRecipeBox(R), B = {x:B0.x * k, y:B0.y * ky, w:B0.w * k, h:B0.h * ky};
  const t = 10 * k;
  const curl = artScrolls(t / 2, t * 0.3, t * 0.8, false) + artScrolls(0, t * 0.8, t * 0.8, true) + artScrolls(t, t * 0.8, t * 0.8, true);
  let defs = artFx(P) + artNoise("grain", ".75", 4, [.35, .35, .35], .35, 5) + artNoise("pits", ".09", 3, [.3, .3, .3], .18, 11)
    + "<pattern id='wp' width='" + tpF(t) + "' height='" + tpF(t) + "' patternUnits='userSpaceOnUse'><rect width='" + tpF(t) + "' height='" + tpF(t) + "' fill='#d9d9dc'/>"
    + "<path d='" + curl + "' fill='none' stroke='#ffffff' stroke-width='.8' transform='translate(.25 .25)'/><path d='" + curl + "' fill='none' stroke='#b4b4b8' stroke-width='.4'/></pattern>"
    + "<linearGradient id='fade' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f2f2f2'/><stop offset='.2' stop-color='#f2f2f2'/><stop offset='.42' stop-color='#f2f2f2' stop-opacity='0'/></linearGradient>"
    + "<linearGradient id='pnl' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fbfbfc'/><stop offset='1' stop-color='#ececee'/></linearGradient>";
  defs += artGateDefs() + artQuiltDefs(k);
  const full = (a) => "<rect width='" + W + "' height='" + H + "' " + a + "/>";
  let s = "";
  // every separate thing drawn here gets a name, so the studio can hand each one over as its own object
  const marks = [], mark = (n, grp) => marks.push([n, grp, s.length]);
  mark("רקע", "bg");
  /* background */
  if(R.bg === "stone") s += full("fill='#e9e9e9'") + artWall(W, H, {rgb:[214, 212, 206], lo:.82, hi:1.04, mortar:"#f4f4f2"}) + full("fill='url(#fade)'");
  else if(R.bg === "damask") s += full("fill='url(#wp)'") + full("filter='url(#cloud)'");
  else if(R.bg === "marble") s += full("fill='#f2f2f3'") + full("filter='url(#mbB)'");
  else if(R.bg === "linen") s += full("fill='#f3f3f4'") + full("filter='url(#tex)'");
  else s += full("fill='#ffffff'") + (R.bg === "cloud" ? full("filter='url(#cloud)'") : "");
  const cut = [s.length];
  mark("מסגרת", "frame");
  /* frame */
  const corner = (x, y, sx, sy, sc) => "<g transform='translate(" + tpF(x) + " " + tpF(y) + ") scale(" + tpF(sx * sc) + " " + tpF(sy * sc) + ")'><path d='" + tpPts(tpSpiral(3, 3, 4.5, Math.PI * 1.25, 1.5, 1, true))
    + "M5 1C10 -.5 14 1 16 4M1 5C-.5 10 1 14 4 16' fill='none' stroke='" + P.lo + "' stroke-width='1.3' stroke-linecap='round'/></g>";
  const four = (x0, y0, x1, y1, sc) => corner(x0, y0, 1, 1, sc) + corner(x1, y0, -1, 1, sc) + corner(x0, y1, 1, -1, sc) + corner(x1, y1, -1, -1, sc);
  if(R.frame === "gate" || R.frame === "gatecurtain"){
    const cw = 15 * k, c0 = 22 * k, c1 = W - 22 * k, top = 28 * k, ped = H - 24 * k;
    if(R.frame === "gatecurtain"){ mark("פרוכת", "frame"); s += artCurtain(c0 + 4 * k, c1 - 4 * k, top + 20 * k, k, 30); }
    mark("עמוד ימין", "frame"); s += artPedestal(c1, ped, H - 8 * k, 24 * k, k) + artColumn(c1, top + 20 * k, ped, cw, k);
    mark("עמוד שמאל", "frame"); s += artPedestal(c0, ped, H - 8 * k, 24 * k, k) + artColumn(c0, top + 20 * k, ped, cw, k);
    mark("כרכוב וגמלון", "frame"); s += artCornice(8 * k, W - 8 * k, top, k) + artPediment(14 * k, W - 14 * k, top - 3.5 * k, k);
  }else if(R.frame === "quilt"){
    s += artQuiltGate(W, H, k);
  }else if(R.frame === "moulding"){
    const o = 9 * k, i = o + 12.5 * k;
    s += "<rect x='" + tpF(i) + "' y='" + tpF(i) + "' width='" + tpF(W - 2 * i) + "' height='" + tpF(H - 2 * i) + "' fill='#ffffff'/>" + artMoulding(W, H, o, k);
  }else if(R.frame === "lines"){
    for(const [d, w] of [[8, 1.1], [10, .3], [12.5, .6]])
      s += "<rect x='" + tpF(d * k) + "' y='" + tpF(d * k) + "' width='" + tpF(W - 2 * d * k) + "' height='" + tpF(H - 2 * d * k) + "' fill='none' stroke='" + P.lo + "' stroke-width='" + w + "'/>";
    mark("סלסולי פינות", "frame"); s += four(14 * k, 14 * k, W - 14 * k, H - 14 * k, 0.8 * k);
  }else if(R.frame === "concave" || R.frame === "white"){
    const o = (R.frame === "white" ? 0.14 * W : 9 * k), oy = R.frame === "white" ? 0.11 * H : o;
    const fr = (d) => artConcave(o + d, oy + d, W - 2 * (o + d), H - 2 * (oy + d), Math.max(1.5, 8 * k - d));
    if(R.frame === "white") s += "<path d='" + fr(0) + "' fill='#ffffff' filter='url(#sh)'/>";
    s += "<path d='" + fr(0) + " " + fr(5.5 * k) + "' fill='url(#metal)' fill-rule='evenodd' filter='url(#sh)'/>"
      + "<path d='" + fr(0) + " " + fr(5.5 * k) + "' fill='url(#metal)' fill-rule='evenodd' filter='url(#bev)'/>"
      + "<path d='" + fr(2.6 * k) + "' fill='none' stroke='" + P.lo + "' stroke-width='.3'/>"
      + "<path d='" + fr(7 * k) + "' fill='none' stroke='" + P.mid + "' stroke-width='.35'/>";
    mark("סלסולי פינות", "frame"); s += four(o, oy, W - o, H - oy, k);
  }else if(R.frame === "filigree"){
    s += "<rect x='" + tpF(7 * k) + "' y='" + tpF(7 * k) + "' width='" + tpF(W - 14 * k) + "' height='" + tpF(H - 14 * k) + "' fill='none' stroke='url(#metal)' stroke-width='" + tpF(2.2 * k) + "' filter='url(#bev)'/>"
      + "<rect x='" + tpF(10.5 * k) + "' y='" + tpF(10.5 * k) + "' width='" + tpF(W - 21 * k) + "' height='" + tpF(H - 21 * k) + "' fill='none' stroke='" + P.mid + "' stroke-width='.35'/>"
      + "<g filter='url(#bev)'>" + artFiligree(12 * k, 12 * k, 1, 1, 0.75 * k) + artFiligree(W - 12 * k, 12 * k, -1, 1, 0.75 * k)
      + artFiligree(12 * k, H - 12 * k, 1, -1, 0.75 * k) + artFiligree(W - 12 * k, H - 12 * k, -1, -1, 0.75 * k) + "</g>";
  }else if(R.frame === "columns"){
    const tile = 7 * k, Rg = tpRng(21);
    let leaves = "";
    for(let i = 0; i < 7; i++) leaves += "<path transform='translate(" + tpF(Rg() * tile) + " " + tpF(Rg() * tile * 1.6) + ") rotate(" + tpF(Rg() * 360) + ") scale(" + tpF((0.32 + Rg() * 0.3) * k) + ")' d='M0 0C2 -2.6 6 -2.8 8 0C6 2.8 2 2.6 0 0Z'/>";
    defs += "<pattern id='dm' width='" + tpF(tile) + "' height='" + tpF(tile * 1.6) + "' patternUnits='userSpaceOnUse'><rect width='" + tpF(tile) + "' height='" + tpF(tile * 1.6) + "' fill='#ffffff'/>"
      + "<path d='M" + tpF(tile * 0.5) + " 0C" + tpF(tile * 0.1) + " " + tpF(tile * 0.4) + " " + tpF(tile * 0.9) + " " + tpF(tile * 0.8) + " " + tpF(tile * 0.5) + " " + tpF(tile * 1.6) + "' fill='none' stroke='" + P.mid + "' stroke-width='.35'/>"
      + "<g fill='" + P.panel + "' stroke='" + P.mid + "' stroke-width='.18'>" + leaves + "</g></pattern>";
    for(const [d, w] of [[8, 1.1], [10, .3], [12.5, .6]])
      s += "<rect x='" + tpF(d * k) + "' y='" + tpF(d * k) + "' width='" + tpF(W - 2 * d * k) + "' height='" + tpF(H - 2 * d * k) + "' fill='none' stroke='" + P.lo + "' stroke-width='" + w + "'/>";
    for(const x of [14 * k, W - 36 * k])
      s += "<rect x='" + tpF(x) + "' y='" + tpF(14 * k) + "' width='" + tpF(22 * k) + "' height='" + tpF(H - 28 * k) + "' fill='url(#dm)' stroke='" + P.mid + "' stroke-width='.6'/>";
  }else if(R.frame === "bar"){
    const bx = 24 * k, seg = (y0, y1) => {
      let g = "<rect x='" + tpF(bx - 3.5 * k) + "' y='" + tpF(y0) + "' width='" + tpF(2.2 * k) + "' height='" + tpF(y1 - y0) + "' fill='url(#metal)' filter='url(#bev)'/>";
      for(let y = y0 + 3 * k; y < y1 - 3 * k; y += 6.2 * k) g += "<path d='" + tpPts(tpSpiral(bx + 1.6 * k, y, 2.2 * k, -Math.PI / 2, 1.2, 1, true)) + "' fill='none' stroke='" + P.lo + "' stroke-width='.35'/>";
      for(let i = 0; i < 9; i++) g += "<line x1='" + tpF(bx + (6 + i * 3.4) * k) + "' y1='" + tpF(y0) + "' x2='" + tpF(bx + (6 + i * 3.4) * k) + "' y2='" + tpF(y1) + "' stroke='" + P.mid + "' stroke-width='.22'/>";
      return g;
    };
    s += seg(14 * k, 0.2 * H) + seg(0.4 * H, H - 14 * k);
  }
  cut.push(s.length);
  mark("לוח באמצע", "panel");
  /* centre panel */
  const shapeOf = {
    cartouche:(d) => artCartouche(B.x + d, B.y + d, B.w - 2 * d, B.h - 2 * d, 12 * k),
    notched:(d) => artConcave(B.x + d, B.y + d, B.w - 2 * d, B.h - 2 * d, Math.max(1.5, 7 * k - d)),
    oval:(d) => "M" + tpF(B.x + d) + " " + tpF(B.y + B.h / 2) + "A" + tpF(B.w / 2 - d) + " " + tpF(B.h / 2 - d) + " 0 1 1 " + tpF(B.x + B.w - d) + " " + tpF(B.y + B.h / 2)
      + "A" + tpF(B.w / 2 - d) + " " + tpF(B.h / 2 - d) + " 0 1 1 " + tpF(B.x + d) + " " + tpF(B.y + B.h / 2) + "Z",
    arch:(d) => { const r = B.w / 2 - d; return "M" + tpF(B.x + d) + " " + tpF(B.y + B.h - d) + "V" + tpF(B.y + B.w / 2) + "A" + tpF(r) + " " + tpF(r) + " 0 0 1 " + tpF(B.x + B.w - d) + " " + tpF(B.y + B.w / 2) + "V" + tpF(B.y + B.h - d) + "Z"; },
    lobed:(d) => {
      const x = B.x + d, y = B.y + 14 * k + d, w = B.w - 2 * d, h = B.h - 28 * k - 2 * d, b = 14 * k;
      return "M" + tpF(x) + " " + tpF(y + b) + "C" + tpF(x) + " " + tpF(y + b * 0.2) + " " + tpF(x + w * 0.25) + " " + tpF(y + b * 0.6) + " " + tpF(x + w * 0.5) + " " + tpF(y - b * 0.9)
        + "C" + tpF(x + w * 0.75) + " " + tpF(y + b * 0.6) + " " + tpF(x + w) + " " + tpF(y + b * 0.2) + " " + tpF(x + w) + " " + tpF(y + b)
        + "V" + tpF(y + h - b) + "C" + tpF(x + w) + " " + tpF(y + h - b * 0.2) + " " + tpF(x + w * 0.75) + " " + tpF(y + h - b * 0.6) + " " + tpF(x + w * 0.5) + " " + tpF(y + h + b * 0.9)
        + "C" + tpF(x + w * 0.25) + " " + tpF(y + h - b * 0.6) + " " + tpF(x) + " " + tpF(y + h - b * 0.2) + " " + tpF(x) + " " + tpF(y + h - b) + "Z";
    },
  }[R.panel];
  if(shapeOf){
    const rim = R.panel === "arch" ? 4.2 * k : 3.2 * k;
    s += "<path d='" + shapeOf(0) + "' fill='url(#metal)' filter='url(#sh)'/><path d='" + shapeOf(0) + "' fill='url(#metal)' filter='url(#bev)'/>"
      + "<path d='" + shapeOf(rim) + "' fill='" + (R.fill === "damask" ? "url(#wp)" : R.fill === "tex" ? P.panel : "url(#pnl)") + "' stroke='" + P.lo + "' stroke-width='.3'/>"
      + (R.fill === "tex" ? "<clipPath id='pc'><path d='" + shapeOf(rim) + "'/></clipPath>" + full("filter='url(#tex)' clip-path='url(#pc)'") : "")
      + (R.panel === "arch" ? "<path d='" + shapeOf(rim + 2.2 * k) + "' fill='none' stroke='#ffffff' stroke-width='.8' stroke-linecap='round' stroke-dasharray='0 1.7'/>"
        : "<path d='" + shapeOf(rim + 1.6 * k) + "' fill='none' stroke='" + (R.fill === "white" ? P.mid : "#ffffff") + "' stroke-width='.45'/>");
  }
  cut.push(s.length);
  mark("קישוט", "orn");
  /* ornaments */
  const top = R.panel === "lobed" ? B.y + 1.5 * k : R.panel === "oval" ? B.y : B.y + (R.panel === "arch" ? -1 * k : 0), bot = B.y + B.h - (R.panel === "lobed" ? 1.5 * k : 0);
  if(R.orn === "crest"){
    const crest = (y, up) => {
      const sg = up ? -1 : 1, c = W / 2;
      return "<ellipse cx='" + tpF(c) + "' cy='" + tpF(y) + "' rx='" + tpF(17 * k) + "' ry='" + tpF(6 * k) + "' fill='#ffffff' filter='url(#sh)'/>"
        + "<path d='" + artScrolls(c, y, 30 * k, up) + "' fill='none' stroke='url(#metal)' stroke-width='" + tpF(1.5 * k) + "' stroke-linecap='round' filter='url(#bev)'/>"
        + "<path d='M" + tpF(c) + " " + tpF(y + sg * k) + "C" + tpF(c - 3 * k) + " " + tpF(y - sg * 2 * k) + " " + tpF(c - 2 * k) + " " + tpF(y - sg * 6 * k) + " " + tpF(c) + " " + tpF(y - sg * 8 * k)
        + "C" + tpF(c + 2 * k) + " " + tpF(y - sg * 6 * k) + " " + tpF(c + 3 * k) + " " + tpF(y - sg * 2 * k) + " " + tpF(c) + " " + tpF(y + sg * k) + "Z' fill='url(#metal)' filter='url(#bev)'/>";
    };
    mark("סמל עליון", "orn"); s += crest(top, true);
    if(R.panel !== "arch"){ mark("סמל תחתון", "orn"); s += crest(bot, false); }
  }else if(R.orn === "scrolls"){
    const sg = "<g filter='url(#bev)' fill='none' stroke='url(#metal)' stroke-width='" + tpF(1.6 * k) + "' stroke-linecap='round'>";
    mark("סלסול עליון", "orn"); s += sg + "<path d='" + artScrolls(W / 2, top - 1.5 * k, 28 * k, true) + "'/></g>";
    if(R.panel !== "arch"){ mark("סלסול תחתון", "orn"); s += sg + "<path d='" + artScrolls(W / 2, bot + 1.5 * k, 28 * k, false) + "'/></g>"; }
  }
  /* a divider under the subtitle and the label behind it */
  const L = tpRecipeText(R).find(o => o.bind === "sub");
  if(R.label && L){
    const ly = (L.y + L.h / 2) * ky, lw = Math.min(B.w - 16 * k, 62 * k), lh = 9 * k, x0 = W / 2 - lw / 2, x1 = W / 2 + lw / 2;
    mark("תווית לבנה", "orn");
    s += "<rect x='" + tpF(x0) + "' y='" + tpF(ly - lh / 2) + "' width='" + tpF(lw) + "' height='" + tpF(lh) + "' fill='#ffffff' stroke='" + P.mid + "' stroke-width='.4' filter='url(#sh)'/>";
    mark("סלסולי התווית", "orn");
    s += "<g fill='none' stroke='" + P.lo + "' stroke-width='.45' stroke-linecap='round'>"
      + "<path d='" + tpPts(tpSpiral(x0 - 4 * k, ly, 2.6 * k, 0, 1.3, 1, true)) + "M" + tpF(x0) + " " + tpF(ly) + "H" + tpF(x0 - 1.5 * k) + "'/>"
      + "<path d='" + tpPts(tpSpiral(x1 + 4 * k, ly, 2.6 * k, Math.PI, 1.3, -1, true)) + "M" + tpF(x1) + " " + tpF(ly) + "H" + tpF(x1 + 1.5 * k) + "'/></g>";
  }else if(L){
    mark("קו מפריד", "orn");
    s += "<path d='" + artScrolls(W / 2, (L.y + L.h + 6) * ky, 22 * k, false) + "' fill='none' stroke='" + P.mid + "' stroke-width='.6' stroke-linecap='round'/>";
  }
  TP_LAST_ART = {defs, s, marks};
  if(R.only){
    const at = {bg:0, frame:1, panel:2, orn:3}[R.only], from = at ? cut[at - 1] : 0, to = at < 3 ? cut[at] : s.length;
    s = s.slice(from, to);
  }
  return "<defs>" + defs + "</defs>" + s;
}
// the box (in mm) that a part really covers, measured off-screen, with room for its shadow
function tpArtBox(W, H, body){
  try{
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-9999px;top:0;width:" + W + "px;height:" + H + "px;visibility:hidden";
    host.innerHTML = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + W + " " + H + "' width='" + W + "' height='" + H + "'><g>" + body.replace(/<defs>[\s\S]*?<\/defs>/, "") + "</g></svg>";
    document.body.appendChild(host);
    const b = host.querySelector("svg > g").getBBox();
    host.remove();
    if(!b.width || !b.height) return {x:0, y:0, w:W, h:H};
    const m = 2, x = Math.max(0, b.x - m), y = Math.max(0, b.y - m);
    return {x, y, w:Math.min(W, b.x + b.width + m) - x, h:Math.min(H, b.y + b.height + m) - y};
  }catch(e){ return {x:0, y:0, w:W, h:H}; }
}
let TP_LAST_ART = null;
// every named piece of a recipe as its own object: [{name, part, body}] — empty pieces left out
function tpArtPieces(R, W, H){
  tpRecipeArt(W, H, R);
  const A = TP_LAST_ART, out = [];
  A.marks.forEach(([name, part, at], i) => {
    const body = A.s.slice(at, i + 1 < A.marks.length ? A.marks[i + 1][2] : A.s.length);
    if(/<(path|rect|g|circle|ellipse|polygon|line|use)\b/.test(body)) out.push({name, part, svg:"<defs>" + A.defs + "</defs>" + body});
  });
  return out;
}
const TP_PART_NAMES = {bg:"רקע", frame:"מסגרת / עמודים", panel:"לוח באמצע", orn:"קישוט"};
// one full-page picture per part of a recipe: background, frame, panel, ornament — each a layer
// that can be moved, resized, hidden, coloured or deleted on its own
function tpArtParts(R, g, onlyPart){
  const r = (v) => +v.toFixed(2), W = r(g.W), H = r(g.H), out = [];
  const key = "pieces|" + JSON.stringify(R) + "|" + W + "|" + H;
  if(!TP_ART_CACHE.has(key))
    TP_ART_CACHE.set(key, tpArtPieces(R, W, H).map(P => {
      // all but the background are trimmed to what they draw, so they move and resize like a picture
      const bx = P.part === "bg" ? {x:0, y:0, w:W, h:H} : tpArtBox(W, H, P.svg);
      const src = "data:image/svg+xml;charset=utf-8," + ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='" + [bx.x, bx.y, bx.w, bx.h].map(tpF).join(" ")
        + "' width='" + tpF(bx.w) + "mm' height='" + tpF(bx.h) + "mm'>" + P.svg + "</svg>").replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\n/g, " ");
      return {name:P.name, part:P.part, src, bx};
    }));
  for(const P of TP_ART_CACHE.get(key)){
    if(onlyPart && P.part !== onlyPart) continue;
    out.push({id:uid("t"), t:"img", art:true, part:P.part, pname:P.name, src:P.src, x:r(P.bx.x), y:r(P.bx.y), w:r(P.bx.w), h:r(P.bx.h), fit:"fill", lock:P.part === "bg"});
  }
  return out;
}
// the words of a recipe, placed inside its panel (170×240 page)
function tpRecipeText(R){
  const B = tpRecipeBox(R), m = R.panel === "oval" ? 14 : R.panel === "none" ? 2 : 7;
  const x = B.x + m, w = B.w - 2 * m, at = (f) => B.y + B.h * f;
  const right = R.frame === "bar";
  const T0 = R.panel === "arch" ? 0.17 : R.panel === "oval" ? 0.2 : R.panel === "lobed" ? 0.17 : 0.13;
  const size = (R.width === "w" || R.panel === "none" ? 46 : 40) * (R.tsize || 1);
  const look = {black:{col:"#111111"}, edge:{col:"#111111", str:1.8, strc:"#ffffff", sh:true, shc:"#000000", shd:.35},
    emboss:{col:"#ffffff", str:1.3, strc:"#6e6e73", sh:true, shc:"#000000", shd:.45}}[R.look || "black"];
  const al = right ? "right" : "center";
  return [
    tpT({text:R.pre == null ? "ספר" : R.pre, x, y:at(T0 - 0.06), w, h:9, size:14, bold:true, al}),
    tpT(Object.assign({bind:"title", x, y:at(T0), w, h:B.h * 0.24, size, bold:true, lh:1.0, font:R.tfont || "b:frankclm", al}, look)),
    tpT({bind:"sub", x:x + (R.label ? 6 : 0), y:at(T0 + 0.27), w:w - (R.label ? 12 : 0), h:9, size:R.label ? 10.5 : 12, bold:true, lh:1.1, al}),
    tpT({text:"חברתי אני הצעיר", x, y:at(0.6), w, h:7, size:10, col:"#555555", al}),
    tpT({bind:"auth", x, y:at(0.6) + 7, w, h:13, size:15, bold:true, font:"b:davidclm", al}),
    tpT({bind:"place", x, y:at(R.panel === "arch" ? 0.86 : 0.8), w, h:13, size:11, lh:1.2, al}),
  ];
}
const TP_RECIPES = [
  ["r_quilt", "קשת מרופדת וחבל שזור", {bg:"marble", frame:"quilt", panel:"none", orn:"none", look:"black", tsize:.95}],
  ["r_gate_curtain", "שער עמודי שיש ופרוכת", {bg:"cloud", frame:"gatecurtain", panel:"none", orn:"none", look:"edge", tsize:.95}],
  ["r_mould", "מסגרת כסף מדורגת על שיש", {bg:"marble", frame:"moulding", panel:"none", orn:"none", look:"black"}],
  ["r_gate", "שער עמודי שיש וכרכוב", {bg:"cloud", frame:"gate", panel:"none", orn:"none", look:"edge", tsize:.95}],
  ["r_gate_curtain2", "פרוכת ועמודים על שיש", {bg:"marble", frame:"gatecurtain", panel:"none", orn:"none", look:"emboss", tsize:.95}],
  ["r_mould2", "מסגרת מדורגת וקרטוש", {bg:"marble", frame:"moulding", panel:"cartouche", fill:"white", orn:"crest", look:"edge", label:true}],
  ["r_gate_panel", "עמודי שיש ולוח לבן", {bg:"marble", frame:"gate", panel:"notched", fill:"white", orn:"none", look:"black", tsize:.9}],
  ["r_ari", "טפט, מסגרת לבנה וקרטוש", {bg:"damask", frame:"white", panel:"cartouche", fill:"damask", orn:"crest", label:true, look:"edge"}],
  ["r_ariel", "מסגרת כסף וקרטוש לבן", {bg:"linen", frame:"concave", panel:"cartouche", fill:"white", orn:"scrolls", label:true}],
  ["r_stone", "חלון קשת באבן ירושלמית", {bg:"stone", frame:"none", panel:"arch", fill:"white", orn:"none", width:"w", look:"emboss", tsize:1.05}],
  ["r_stone2", "קשת באבן עם סמל", {bg:"stone", frame:"none", panel:"arch", fill:"white", orn:"crest", width:"w", look:"edge"}],
  ["r_avanim", "פיליגרן וקרטוש מעוגל", {bg:"cloud", frame:"filigree", panel:"lobed", fill:"white", orn:"scrolls", width:"w"}],
  ["r_avanim2", "פיליגרן על טפט", {bg:"damask", frame:"filigree", panel:"lobed", fill:"white", orn:"crest", width:"w", label:true}],
  ["r_shemen", "עמודי עלים", {bg:"white", frame:"columns", panel:"none", orn:"none", look:"emboss", width:"w"}],
  ["r_shemen2", "עמודי עלים וקרטוש", {bg:"white", frame:"columns", panel:"notched", fill:"white", orn:"scrolls", label:true}],
  ["r_ahava", "מודרני — פס תלתלים", {bg:"white", frame:"bar", panel:"none", orn:"none", tfont:"b:vilnat", tsize:1.15}],
  ["r_ahava2", "מודרני על נייר", {bg:"linen", frame:"bar", panel:"none", orn:"none", look:"edge", tfont:"b:shofar"}],
  ["r_oval", "מדליון אליפסה", {bg:"cloud", frame:"lines", panel:"oval", fill:"white", orn:"crest", width:"w"}],
  ["r_oval2", "אליפסה על טפט", {bg:"damask", frame:"concave", panel:"oval", fill:"white", orn:"none", width:"w", look:"edge"}],
  ["r_notched", "מלבן כסף על טפט", {bg:"damask", frame:"none", panel:"notched", fill:"white", orn:"crest", width:"w", label:true, look:"edge"}],
  ["r_notched2", "מלבן כסף ונייר", {bg:"linen", frame:"lines", panel:"notched", fill:"tex", orn:"scrolls", width:"w", look:"edge"}],
  ["r_cart_tex", "קרטוש אפור במסגרת לבנה", {bg:"cloud", frame:"white", panel:"cartouche", fill:"tex", orn:"crest", look:"edge", label:true}],
  ["r_cart_wide", "קרטוש רחב בקווים", {bg:"white", frame:"lines", panel:"cartouche", fill:"white", orn:"scrolls", width:"w", tfont:"b:yehuda"}],
  ["r_arch_frame", "קשת במסגרת כסף", {bg:"linen", frame:"concave", panel:"arch", fill:"white", orn:"scrolls", look:"emboss"}],
  ["r_arch_fil", "קשת ופיליגרן", {bg:"cloud", frame:"filigree", panel:"arch", fill:"tex", orn:"none", look:"edge"}],
  ["r_plain_fil", "פיליגרן נקי", {bg:"white", frame:"filigree", panel:"none", orn:"none", tfont:"b:keterb", tsize:1.1}],
  ["r_lobed_dm", "קרטוש מעוגל אפור", {bg:"white", frame:"lines", panel:"lobed", fill:"damask", orn:"crest", width:"w", look:"edge", label:true}],
];
/* ------------------------------------------------ text boxes for each layout */
const tpT = (o) => Object.assign({t:"txt", al:"center", lh:1.2, col:"#111111", font:"b:frank"}, o);
const tpEmboss = (o, face, line, shade) => tpT(Object.assign({bold:true, col:face, str:1.1, strc:line, sh:true, shc:shade || "#000000", shd:.35, lh:1.0}, o));
const TP_TEXT = {
  cartouche:(P) => [
    tpT({bind:"title", x:50, y:44, w:70, h:46, size:40, bold:true, lh:1.05, col:P.ink, font:"b:frankclm"}),
    tpT({bind:"sub", x:50, y:94, w:70, h:13, size:13, bold:true, col:P.ink, bgc:P.band, bdr:true, bdw:.4, bdc:P.mid}),
    tpT({text:"חברתי אני הצעיר", x:50, y:150, w:70, h:7, size:10, col:P.soft}),
    tpT({bind:"auth", x:50, y:158, w:70, h:14, size:15, bold:true, col:P.ink}),
    tpT({bind:"place", x:50, y:176, w:70, h:14, size:11, lh:1.2, col:P.ink})],
  filigree:(P) => [
    tpT({text:"ספר", x:45, y:62, w:80, h:10, size:15, col:P.ink}),
    tpT({bind:"title", x:40, y:73, w:90, h:22, size:34, bold:true, lh:1.05, col:P.ink, font:"b:frankclm"}),
    tpT({bind:"sub", x:44, y:100, w:82, h:24, size:12, lh:1.35, col:P.ink}),
    tpT({text:"חברתי אני הצעיר", x:44, y:134, w:82, h:7, size:10, col:P.soft}),
    tpT({bind:"auth", x:44, y:142, w:82, h:14, size:15, bold:true, col:P.ink}),
    tpT({bind:"place", x:44, y:166, w:82, h:13, size:10.5, lh:1.2, col:P.soft})],
  damask:(P) => [
    tpT({text:"ספר", x:44, y:34, w:82, h:12, size:16, col:P.soft}),
    tpEmboss({bind:"title", x:42, y:48, w:86, h:24, size:38}, P.panel, P.lo, "#000000"),
    tpT({bind:"sub", x:46, y:82, w:78, h:26, size:12.5, bold:true, lh:1.35, col:P.ink}),
    tpT({text:"מאת המחבר", x:46, y:180, w:78, h:7, size:10, col:P.soft}),
    tpT({bind:"auth", x:46, y:187, w:78, h:12, size:14, bold:true, col:P.ink}),
    tpT({bind:"place", x:46, y:202, w:78, h:12, size:10.5, lh:1.2, col:P.soft})],
  modern:(P) => [
    tpT({bind:"title", x:28, y:52, w:84, h:40, size:50, bold:true, lh:.95, col:P.ink, al:"right", font:"b:vilnat"}),
    tpT({bind:"sub", x:28, y:128, w:118, h:40, size:12.5, lh:1.45, col:P.ink, al:"right", bold:true}),
    tpT({bind:"auth", x:40, y:196, w:80, h:12, size:12, bold:true, col:P.ink}),
    tpT({bind:"place", x:40, y:208, w:80, h:12, size:10, lh:1.2, col:P.soft})],
  wallpaper:(P) => [
    tpT({bind:"title", x:47, y:50, w:76, h:52, size:54, bold:true, lh:1.0, col:P.ink, font:"b:frankclm", str:1.8, strc:"#ffffff", sh:true, shc:"#000000", shd:.35}),
    tpT({bind:"sub", x:57, y:106.4, w:56, h:9, size:10, bold:true, col:P.ink, lh:1.05}),
    tpT({text:"חברתי אני הצעיר", x:50, y:132, w:70, h:7, size:10, col:P.soft}),
    tpT({bind:"auth", x:50, y:140, w:70, h:14, size:15, bold:true, col:P.ink, font:"b:davidclm"}),
    tpT({bind:"place", x:50, y:162, w:70, h:13, size:11, lh:1.2, col:P.ink})],
  stone:() => [
    tpT({bind:"auth", x:40, y:34, w:90, h:9, size:10.5}),
    tpT({text:"ספר", x:40, y:51, w:90, h:13, size:19, bold:true}),
    tpEmboss({bind:"title", x:28, y:64, w:114, h:28, size:44}, "#f2f2f3", "#9b9ba0", "#000000"),
    tpT({bind:"sub", x:36, y:94, w:98, h:18, size:11.5, lh:1.3, bold:true}),
    tpT({bind:"place", x:40, y:216, w:90, h:13, size:10.5, lh:1.15})],
  parchment:() => [
    tpT({bind:"auth", x:40, y:33, w:90, h:9, size:10.5, col:"#5a4210"}),
    tpT({text:"ספר", x:40, y:50, w:90, h:13, size:19, bold:true, col:"#5a4210"}),
    tpEmboss({bind:"title", x:28, y:64, w:114, h:28, size:44}, "#e9c766", "#6b4e10", "#3a2a06"),
    tpT({bind:"sub", x:36, y:95, w:98, h:18, size:11.5, lh:1.3, bold:true, col:"#5a4210"}),
    tpT({bind:"place", x:40, y:216, w:90, h:13, size:10.5, lh:1.15, col:"#5a4210"})],
  leather:() => [
    tpT({bind:"auth", x:40, y:35, w:90, h:9, size:10.5, col:"#e3c77d"}),
    tpT({text:"ספר", x:40, y:52, w:90, h:13, size:19, bold:true, col:"#e3c77d"}),
    tpEmboss({bind:"title", x:28, y:66, w:114, h:28, size:44}, "#f0cf72", "#7a5810", "#000000"),
    tpT({bind:"sub", x:36, y:97, w:98, h:18, size:11.5, lh:1.3, bold:true, col:"#ecd9a4"}),
    tpT({bind:"place", x:40, y:216, w:90, h:13, size:10.5, lh:1.15, col:"#e3c77d"})],
};
// Eli: "שאפשר לכתוב מה אני רוצה והמערכת תתרגם לעיצוב". Plain words → parts of the recipe.
// Each rule: words to look for (any of them), the part and its value, and how to say it back.
const TP_WORDS = [
  [["אבן", "ירושלמ", "כותל", "חומה", "לבנים"], "bg", "stone"], [["טפט", "דמשק", "דוגמה ברקע", "מסולסל ברקע"], "bg", "damask"],
  [["נייר", "מחוספס", "מרקם"], "bg", "linen"], [["שיש", "משויש"], "bg", "marble"], [["ענן", "עננות"], "bg", "cloud"], [["רקע לבן", "נקי"], "bg", "white"],
  [["מסגרת כסף", "מסגרת מסולסלת", "מסגרת בולטת"], "frame", "concave"], [["מסגרת לבנה"], "frame", "white"],
  [["פיליגרן", "סלסולים בפינות", "קישוט בפינות", "פינות"], "frame", "filigree"], [["עמוד", "עלים", "עלווה"], "frame", "columns"],
  [["עמודי שיש", "שער עמודים", "כרכוב"], "frame", "gate"], [["פרוכת", "וילון", "מסך"], "frame", "gatecurtain"], [["מרופד", "ריפוד", "חבל", "שזור", "כפתורים"], "frame", "quilt"], [["מדורג", "מסגרת עבה", "מסגרת כפולה"], "frame", "moulding"], [["מודרני", "פס"], "frame", "bar"], [["קווים", "מסגרת דקה", "קו דק"], "frame", "lines"], [["בלי מסגרת"], "frame", "none"],
  [["קשת", "חלון"], "panel", "arch"], [["אליפסה", "עיגול", "מדליון", "סגלגל"], "panel", "oval"],
  [["קרטוש מעוגל", "לוח מעוגל", "גלי"], "panel", "lobed"], [["קרטוש", "לוח גבוה"], "panel", "cartouche"],
  [["מלבן", "ריבוע", "פינות חתוכות"], "panel", "notched"], [["בלי לוח", "בלי מסגרת פנימית"], "panel", "none"],
  [["לוח אפור", "מילוי אפור"], "fill", "tex"], [["לוח טפט", "טפט בפנים"], "fill", "damask"], [["לוח לבן"], "fill", "white"],
  [["רחב"], "width", "w"], [["צר"], "width", "n"],
  [["סמל", "כתר", "שושנה", "חותם"], "orn", "crest"], [["סלסול", "תלתל", "קישוטים"], "orn", "scrolls"], [["בלי קישוט", "פשוט"], "orn", "none"],
  [["אותיות כסף", "בולט", "תבליט", "חלול"], "look", "emboss"], [["שוליים לבנים", "מתאר"], "look", "edge"], [["אותיות שחורות", "שחור"], "look", "black"],
  [["תווית", "פס לבן"], "label", true], [["בלי תווית"], "label", false],
  [["סת\"ם", "סתם"], "tfont", "b:stam"], [["וילנא", "ישן", "עתיק"], "tfont", "b:vilnat"], [["יהודה"], "tfont", "b:yehuda"],
  [["כתר עבה", "גופן כתר"], "tfont", "b:keterb"], [["שופר"], "tfont", "b:shofar"], [["דוד"], "tfont", "b:davidclm"],
  [["פרנק", "עבה", "כבד"], "tfont", "b:frankclm"], [["דרוגולין"], "tfont", "b:drugulin"],
];
// returns the new recipe and the list of what was understood
function tpFromWords(text, base){
  const t = " " + String(text || "").replace(/[״]/g, "\"").replace(/\s+/g, " ") + " ";
  const R = Object.assign({bg:"white", frame:"none", panel:"cartouche", fill:"white", orn:"none", width:"n", look:"black"}, base || {});
  const got = [], seen = new Set();
  // longer phrases first, so "קרטוש מעוגל" wins over "קרטוש" and "בלי קישוט" over "קישוטים"
  const rules = TP_WORDS.flatMap(([ws, key, val]) => ws.map(w => [w, key, val])).sort((a, b) => b[0].length - a[0].length);
  let rest = t;
  for(const [w, key, val] of rules){
    if(!rest.includes(w) || seen.has(key)) continue;
    rest = rest.split(w).join(" ");
    seen.add(key);
    R[key] = val;
    const names = Object.assign({}, ...Object.entries(TP_PARTS).map(([k, l]) => ({[k]:Object.fromEntries(l)})));
    const label = {bg:"רקע", frame:"מסגרת", panel:"לוח באמצע", fill:"מילוי הלוח", width:"רוחב", orn:"קישוט", look:"שם הספר", label:"תווית", tfont:"גופן"}[key];
    const v = key === "look" ? TP_TITLE_LOOK[val] : key === "label" ? (val ? "כן" : "בלי") : key === "tfont" ? w : (names[key] || {})[val];
    got.push(label + ": " + v);
  }
  return {R, got};
}
const TP_RICH = TP_RECIPES.map(([k, name, R]) => ({k, name, recipe:R, art:(W, H) => tpRecipeArt(W, H, R), items:tpRecipeText(R)}));
TP_PRESETS.push(...TP_RICH);
const TP_ART_CACHE = new Map();
function tpRichItems(P, g){
  const fx = g.W / 170, fy = g.H / 240, r = (v) => +v.toFixed(2);
  const key = P.k + "|" + JSON.stringify(P.recipe || "") + "|" + g.W + "|" + g.H;
  if(!TP_ART_CACHE.has(key)) TP_ART_CACHE.set(key, tpSvgURL(r(g.W), r(g.H), P.art(r(g.W), r(g.H))));
  const art = P.recipe ? tpArtParts(P.recipe, g) : [{id:uid("t"), t:"img", art:true, src:TP_ART_CACHE.get(key), x:0, y:0, w:r(g.W), h:r(g.H), fit:"fill", lock:true}];
  return art.concat(P.items.map(o => Object.assign({}, o, {id:uid("t"), x:r(o.x * fx), y:r(o.y * fy), w:r(o.w * fx), h:r(o.h * fy)},
    o.size ? {size:+(o.size * fx).toFixed(1)} : {})));
}
function tpFromPreset(k, frame, g){
  const P = TP_PRESETS.find(p => p.k === k) || TP_PRESETS[0];
  if(P.items){
    const base = TP_PRESETS[0];
    return Object.assign(JSON.parse(JSON.stringify({preset:P.k, frame:"none", font:P.font, lines:base.lines})),
      {mode:"free", bg:P.bg || "", recipe:P.recipe ? JSON.parse(JSON.stringify(P.recipe)) : null, items:tpRichItems(P, g || {W:170, H:240})});
  }
  const t = JSON.parse(JSON.stringify({preset:P.k, frame:P.frame, font:P.font, lines:P.lines}));
  if(frame) t.frame = frame;
  return t;
}
// a book never designed here keeps the classic שער with the frame of its template
function tpOf(st){ return st.tp && Array.isArray(st.tp.lines) ? st.tp : tpFromPreset("classic", st.titleFrame || "double"); }
const TP_ORN_HTML = {line:"<i></i>❖<i></i>", rule:"<i></i>", double:"<i class=\"d\"></i>", stars:"★ ☆ ★", diam:"◆ ◇ ◆",
  flower:"❦", leaf:"☙ ❦ ❧", dots:"• • •"};
TP_ORN_GLYPHS.forEach((c, i) => { TP_ORN_HTML["g1_" + i] = c; TP_ORN_HTML["gl_" + i] = "<i></i>" + c + "<i></i>"; TP_ORN_HTML["g3_" + i] = c + " " + c + " " + c; });
Object.assign(TP_ORN_HTML, {wave:"〰〰〰", dash3:"<i></i>◆<i></i>", pair:"❧ ☙", curl:"<i></i>☙ ❖ ❧<i></i>", crown:"⚜ ✡ ⚜", bloom:"✿ ❀ ✿ ❀ ✿"});
function tpText(book, L){
  const v = (x) => String(x || "").trim();
  if(L.k === "title") return v(book.title);
  if(L.k === "sub") return v(book.subtitle);
  if(L.k === "auth") return v(book.author);
  if(L.k === "place") return [book.place, book.year].map(v).filter(Boolean).join("\n");
  return v(L.text);
}
function tpHTML(book, st, tp){
  if(tp.mode === "free") return tpFreeHTML(book, st, tp);
  const fx = geometry(st).W / 170;
  const corners = tp.frame === "ornate" || tp.frame === "corners"
    ? "<i class=\"bk-c c1\">❖</i><i class=\"bk-c c2\">❖</i><i class=\"bk-c c3\">❖</i><i class=\"bk-c c4\">❖</i>"
      + (tp.frame === "ornate" ? "<i class=\"bk-c c5\">◆◇◆</i><i class=\"bk-c c6\">◆◇◆</i>" : "") : "";
  let html = "", bottom = false;
  tp.lines.forEach((L, i) => {
    const isOrn = L.k === "orn";
    const txt = isOrn ? "" : tpText(book, L);
    if(!isOrn && !txt) return;
    const pt = (Number(L.size) || 12) * fx;
    const css = "font-family:" + fontStack(L.font || tp.font || st.headFont).replace(/"/g, "'") + ";font-size:" + pt.toFixed(2) + "pt"
      + ";font-weight:" + (L.bold ? 700 : 400) + (L.ls ? ";letter-spacing:" + L.ls + "em" : "")
      + (L.bottom && !bottom ? ";margin-top:auto" + (L.gap ? ";padding-top:" + L.gap + "mm" : "") : L.gap ? ";margin-top:" + L.gap + "mm" : "");
    if(L.bottom) bottom = true;
    html += isOrn
      ? "<div class=\"bk-tp-orn o-" + esc(L.orn || "line") + "\" data-tpi=\"" + i + "\" style=\"" + css + "\">" + (TP_ORN_HTML[L.orn] || TP_ORN_HTML.line) + "</div>"
      : "<div class=\"bk-tpx k-" + L.k + (L.look === "outline" ? " hollow" : "") + "\" data-tpi=\"" + i + "\" data-tps=\"" + pt.toFixed(2) + "\" style=\"" + css + "\">" + esc(txt) + "</div>";
  });
  return "<div class=\"bk-tp f-" + esc(tp.frame || "double") + "\">" + corners + tpFrameArt(tp.frame) + html + "</div>";
}
/* ------------------------------------------- the שער as a free page (סטודיו) */
// Eli: "שאבא יוכל לעצב את העמוד כמו סטודיו". In the studio the שער is a free page: every
// item (text box, picture, shape, line, ornament) sits where it was put, in millimetres from
// the page corner, with its own size, turn, colour and see-through; the list order is the
// layering (later = on top). Text boxes may be tied to the book details (שם הספר…).
const tpCol = (v, d) => /^#[0-9a-fA-F]{3,8}$/.test(String(v || "")) ? v : d;
const tpNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
// shapes drawn on a 100×100 square that stretches with the item (the line keeps its width)
const ST_SHAPES = {star:"⭐ כוכב", poly:"⬢ משושה", ribbon:"🎗 סרט לכותרת", archdoor:"⌂ קשת / פתח", medal:"✺ מדליון", diamond:"◆ מעוין", shield:"🛡 מגן", oval:"⬭ אליפסה כפולה"};
function tpShapePath(it){
  const pts = (arr) => "M" + arr.map(p => p.map(v => v.toFixed(2)).join(",")).join(" L") + " Z";
  const ring = (n, rad, off) => Array.from({length:n}, (_, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2 + (off || 0);
    return [50 + rad(i) * Math.cos(a), 50 + rad(i) * Math.sin(a)];
  });
  const n = Math.max(3, Math.min(16, Math.round(tpNum(it.pts, it.shape === "poly" ? 6 : 5))));
  switch(it.shape){
    case "star": return pts(ring(n * 2, i => i % 2 ? 50 * tpNum(it.inner, 0.45) : 50));
    case "poly": return pts(ring(n, () => 50));
    case "diamond": return "M50,0 L100,50 L50,100 L0,50 Z";
    case "ribbon": return "M12,12 H88 V70 H12 Z M0,28 H12 V86 H0 L7,57 Z M100,28 H88 V86 H100 L93,57 Z";
    case "archdoor": return "M0,100 V45 A50,45 0 0 1 100,45 V100 Z";
    case "shield": return "M0,0 H100 V45 C100,75 70,92 50,100 C30,92 0,75 0,45 Z";
    case "oval": return "M50,0 A50,50 0 1 1 49.99,0 Z M50,9 A41,41 0 1 1 49.99,9 Z";
    case "medal": {
      const m = 24, out = [];
      for(let i = 0; i < m; i++){
        const a = (i / m) * 2 * Math.PI - Math.PI / 2, b = ((i + 1) / m) * 2 * Math.PI - Math.PI / 2;
        if(!i) out.push("M" + (50 + 44 * Math.cos(a)).toFixed(2) + "," + (50 + 44 * Math.sin(a)).toFixed(2));
        out.push("A6,6 0 0 1 " + (50 + 44 * Math.cos(b)).toFixed(2) + "," + (50 + 44 * Math.sin(b)).toFixed(2));
      }
      return out.join(" ") + " Z";
    }
  }
  return "M0,0 H100 V100 H0 Z";
}
function tpFill(it, gid){
  const f = tpCol(it.fill, ""), f2 = tpCol(it.fill2, "");
  if(f && f2){
    const v = it.gdir === "v";
    return {fill:"url(#" + gid + ")", defs:"<defs><linearGradient id=\"" + gid + "\" x1=\"0\" y1=\"0\" x2=\"" + (v ? 0 : 1) + "\" y2=\"" + (v ? 1 : 0)
      + "\"><stop offset=\"0\" stop-color=\"" + f + "\"/><stop offset=\"1\" stop-color=\"" + f2 + "\"/></linearGradient></defs>",
      css:"linear-gradient(" + (v ? "180deg" : "90deg") + "," + f + "," + f2 + ")"};
  }
  return {fill:f || "none", defs:"", css:f || "transparent"};
}
const tpShadow = (it, text) => {
  if(!it.sh) return "";
  const c = tpCol(it.shc, "#000000"), d = tpNum(it.shd, 0.6);
  return text ? ";text-shadow:" + d + "mm " + d + "mm " + (d * 0.5).toFixed(2) + "mm " + c + "80"
    : ";filter:drop-shadow(" + d + "mm " + d + "mm " + (d * 0.5).toFixed(2) + "mm " + c + "80)";
};
// a drawn piece of a שער in another colour: its light and shade kept, the silver/white turned to the colour
const TP_TINT_CACHE = new Map();
function tpTinted(src, tint){
  if(!tint || !/^#[0-9a-f]{6}$/i.test(tint) || !src.startsWith("data:image/svg+xml")) return src;
  const key = tint + src.length + src.slice(-80);
  if(TP_TINT_CACHE.has(key)) return TP_TINT_CACHE.get(key);
  try{
    const c = [1, 3, 5].map(i => parseInt(tint.slice(i, i + 2), 16) / 255);
    const m = c.map(v => [.3 * v, .59 * v, .11 * v, 0, 0].map(x => +x.toFixed(4)).join(" ")).join(" ") + " 0 0 0 1 0";
    let svg = decodeURIComponent(src.slice(src.indexOf(",") + 1));
    const open = svg.indexOf(">") + 1;
    svg = svg.slice(0, open) + "<filter id='tntF' color-interpolation-filters='sRGB'><feColorMatrix type='matrix' values='" + m + "'/></filter><g filter='url(#tntF)'>"
      + svg.slice(open).replace(/<\/svg>\s*$/, "</g></svg>");
    const out = "data:image/svg+xml;charset=utf-8," + svg.replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E");
    TP_TINT_CACHE.set(key, out);
    return out;
  }catch(e){ return src; }
}
function tpItemHTML(book, st, it){
  const op = tpNum(it.op, 1);
  const tr = (it.rot ? "rotate(" + tpNum(it.rot, 0) + "deg) " : "") + (it.flip ? "scaleX(-1)" : "");
  const box = "left:" + tpNum(it.x, 0).toFixed(2) + "mm;top:" + tpNum(it.y, 0).toFixed(2) + "mm;width:" + Math.max(1, tpNum(it.w, 20)).toFixed(2)
    + "mm;height:" + Math.max(0.5, tpNum(it.h, 10)).toFixed(2) + "mm" + (tr ? ";transform:" + tr.trim() : "")
    + (op < 1 ? ";opacity:" + Math.max(0.05, op) : "");
  const id = " data-tid=\"" + esc(it.id) + "\"";
  if(it.t === "img"){
    const flt = [it.gray ? "grayscale(1)" : "", it.sepia ? "sepia(.85)" : "",
      tpNum(it.bri, 100) !== 100 ? "brightness(" + tpNum(it.bri, 100) / 100 + ")" : "",
      tpNum(it.con, 100) !== 100 ? "contrast(" + tpNum(it.con, 100) / 100 + ")" : ""].filter(Boolean).join(" ");
    const clip = ({circle:";border-radius:50%", round:";border-radius:6mm", arch:";border-radius:50% 50% 0 0 / 35% 35% 0 0"})[it.clip] || "";
    return "<img class=\"bk-tpi img\"" + id + " src=\"" + esc(String(it.src || "").startsWith("data:image/") ? tpTinted(it.src, it.tint) : "") + "\" alt=\"\" style=\"" + box
      + ";object-fit:" + (it.fit === "fill" || clip ? "cover" : "contain") + (flt ? ";filter:" + flt : "") + clip + tpShadow(it, false) + "\"/>";
  }
  if(it.t === "shape"){
    const c = tpCol(it.col, "#000000"), sw = Math.max(0, tpNum(it.sw, 1));
    const line = sw ? sw + "pt " + (it.dash ? "dashed" : "solid") + " " + c : "none";
    if(it.shape === "line") return "<div class=\"bk-tpi line\"" + id + " style=\"" + box + tpShadow(it, false) + "\"><i style=\"border-top:" + (sw ? line : ".6pt solid " + c) + "\"></i></div>";
    const F = tpFill(it, "g" + String(it.id).replace(/\W/g, ""));
    if(it.shape === "rect" || it.shape === "ellipse")
      return "<div class=\"bk-tpi shp\"" + id + " style=\"" + box + ";border:" + line + ";background:" + F.css
        + ";border-radius:" + (it.shape === "ellipse" ? "50%" : tpNum(it.rad, 0) + "mm")
        + (it.dbl && sw ? ";outline:" + line + ";outline-offset:1.4mm" : "") + tpShadow(it, false) + "\"></div>";
    return "<svg class=\"bk-tpi svg\"" + id + " style=\"" + box + tpShadow(it, false) + "\" viewBox=\"0 0 100 100\" preserveAspectRatio=\"none\">" + F.defs
      + "<path d=\"" + tpShapePath(it) + "\" fill=\"" + F.fill + "\" fill-rule=\"evenodd\" stroke=\"" + (sw ? c : "none") + "\" stroke-width=\"" + (sw * 4 / 3).toFixed(2)
      + "\" vector-effect=\"non-scaling-stroke\" stroke-linejoin=\"round\"" + (it.dash ? " stroke-dasharray=\"6 4\"" : "") + "/></svg>";
  }
  const al = ["right", "center", "left"].includes(it.al) ? it.al : "center";
  const c = tpCol(it.col, "#000000");
  const txt = it.bind ? tpText(book, {k: it.bind}) : String(it.text || "");
  const font = fontStack(it.font || st.headFont).replace(/"/g, "'");
  const ow = tpNum(it.str, 0), oc = tpCol(it.strc, c);
  const stroke = it.hollow ? ";color:#fff;-webkit-text-stroke:" + (ow || 0.7) + "pt " + c : ";color:" + c + (ow ? ";-webkit-text-stroke:" + ow + "pt " + oc + ";paint-order:stroke fill" : "");
  const boxBg = (tpCol(it.bgc, "") ? ";background:" + it.bgc : "") + (it.bdr ? ";border:" + Math.max(0.3, tpNum(it.bdw, 0.8)) + "pt solid " + tpCol(it.bdc, c) + ";border-radius:" + tpNum(it.rad, 0) + "mm" : "")
    + (it.bgc || it.bdr ? ";padding:0 " + tpNum(it.pad, 2) + "mm" : "");
  const sx = tpNum(it.sx, 100);
  const arc = Math.max(-300, Math.min(300, tpNum(it.arc, 0)));
  if(arc && txt){
    // curved text: the words themselves bend by the chosen angle (their length is estimated
    // from the letter count), around the middle of the box; the path runs a little further
    const w = Math.max(1, tpNum(it.w, 20)), hh = Math.max(1, tpNum(it.h, 10)), fs = tpNum(it.size, 14) * 0.3528;
    const flat = txt.replace(/\s*\n\s*/g, " ").replace(/[֑-ׇ]/g, "");
    const L = Math.max(fs, flat.length * fs * 0.52 * (1 + tpNum(it.ls, 0)) * (tpNum(it.sx, 100) / 100));
    const A = Math.abs(arc) * Math.PI / 180, r = L / A, T2 = Math.min(Math.PI * 0.98, A * 0.65 + 0.15);
    const up = arc > 0, cx = w / 2, mid = up ? fs * 0.95 : hh - fs * 0.3;
    const dy = r * (1 - Math.cos(T2)) * (up ? 1 : -1), ex = r * Math.sin(T2);
    const pid = "p" + String(it.id).replace(/\W/g, "");
    return "<svg class=\"bk-tpi arc\"" + id + " style=\"" + box + tpShadow(it, false) + "\" viewBox=\"0 0 " + w.toFixed(2) + " " + hh.toFixed(2) + "\" overflow=\"visible\">"
      + "<path id=\"" + pid + "\" fill=\"none\" d=\"M" + (cx - ex).toFixed(2) + "," + (mid + dy).toFixed(2) + " A" + r.toFixed(2) + "," + r.toFixed(2) + " 0 " + (T2 > Math.PI / 2 ? 1 : 0) + " " + (up ? 1 : 0) + " " + (cx + ex).toFixed(2) + "," + (mid + dy).toFixed(2) + "\"/>"
      + "<text font-family=\"" + font + "\" font-size=\"" + fs.toFixed(2) + "\" font-weight=\"" + (it.bold ? 700 : 400) + "\" letter-spacing=\"" + (tpNum(it.ls, 0) * fs).toFixed(2)
      + "\" fill=\"" + (it.hollow ? "#fff" : c) + "\"" + (it.hollow || ow ? " stroke=\"" + (it.hollow ? c : oc) + "\" stroke-width=\"" + ((ow || 0.7) * 0.3528).toFixed(3) + "\" paint-order=\"stroke\"" : "")
      + " text-anchor=\"middle\" direction=\"rtl\"><textPath href=\"#" + pid + "\" startOffset=\"50%\">" + esc(txt.replace(/\s*\n\s*/g, " ")) + "</textPath></text></svg>";
  }
  return "<div class=\"bk-tpi txt\"" + id + " style=\"" + box + ";font-family:" + font
    + ";font-size:" + tpNum(it.size, 14) + "pt;font-weight:" + (it.bold ? 700 : 400) + ";text-align:" + al
    + ";justify-content:" + ({right:"flex-start", center:"center", left:"flex-end"})[al]
    + (it.ls ? ";letter-spacing:" + tpNum(it.ls, 0) + "em" : "") + ";line-height:" + tpNum(it.lh, 1.25)
    + stroke + boxBg + tpShadow(it, true) + "\"><span" + (sx !== 100 ? " style=\"transform:scaleX(" + sx / 100 + ")\"" : "") + ">" + esc(txt) + "</span></div>";
}
function tpFreeHTML(book, st, tp){
  const frame = tp.frame || "none";
  const corners = frame === "ornate" || frame === "corners"
    ? "<i class=\"bk-c c1\">❖</i><i class=\"bk-c c2\">❖</i><i class=\"bk-c c3\">❖</i><i class=\"bk-c c4\">❖</i>"
      + (frame === "ornate" ? "<i class=\"bk-c c5\">◆◇◆</i><i class=\"bk-c c6\">◆◇◆</i>" : "") : "";
  return "<div class=\"bk-tpfree\" style=\"background:" + tpCol(tp.bg, "transparent") + "\"></div>"
    + "<div class=\"bk-tp f-" + esc(frame) + "\">" + corners + tpFrameArt(frame) + "</div>"
    + "<div class=\"bk-tpfree\">" + (tp.items || []).filter(it => !it.hide).map(it => tpItemHTML(book, st, it)).join("") + "</div>";
}
// the שער as it is now (lines) turned into free items at the very same places
function tpToFree(book, st){
  const tp = tpOf(st);
  const P = titlePages(book, Object.assign({}, st, {tp: Object.assign({}, tp, {mode:"lines"})}), $("bkMeasure"))[0];
  const M = $("bkMeasure");
  M.appendChild(P.el);
  const pr = P.el.getBoundingClientRect(), k = pr.width / (geometry(st).W * MM);
  const box = P.el.querySelector(".bk-tp").getBoundingClientRect();
  const mm = (px) => +(px / k / MM).toFixed(2);
  const items = [];
  for(const el of P.el.querySelectorAll("[data-tpi]")){
    const L = tp.lines[Number(el.dataset.tpi)], r = el.getBoundingClientRect();
    const y = mm(r.top - pr.top), h = Math.max(4, mm(r.height));
    if(L.k === "orn"){
      const glyph = el.textContent.trim();
      if(!glyph || el.querySelector("i")){
        items.push({id:uid("t"), t:"shape", shape:"line", x:mm(r.left - pr.left), y:y + h / 2 - 1, w:mm(r.width), h:2, sw:L.orn === "double" ? 1.2 : 0.6, col:"#000000"});
        if(!glyph) continue;
      }
      items.push({id:uid("t"), t:"txt", text:glyph, x:mm(box.left - pr.left), y, w:mm(box.width), h, size:+(parseFloat(getComputedStyle(el).fontSize) * 0.75).toFixed(1),
        font:L.font || tp.font || "", al:"center", ls:0.35});
      continue;
    }
    const bind = {title:"title", sub:"sub", auth:"auth", place:"place"}[L.k] || "";
    items.push({id:uid("t"), t:"txt", bind, text:bind ? "" : L.text, x:mm(box.left - pr.left), y, w:mm(box.width), h:h + 1,
      size:+(parseFloat(getComputedStyle(el).fontSize) * 0.75).toFixed(1), font:L.font || tp.font || "", bold:!!L.bold,
      ls:Number(L.ls) || 0, hollow:L.look === "outline", al:"center", lh:L.k === "title" ? 1.15 : 1.3});
  }
  P.el.remove();
  return Object.assign(JSON.parse(JSON.stringify(tp)), {mode:"free", items, bg:""});
}
function titlePages(book, st, measure){
  const lines = (s) => esc(String(s || "").trim());
  const tp = tpHTML(book, st, tpOf(st));
  const back = "<div class=\"bk-back\">"
    + (String(book.dedication || "").trim() ? "<div class=\"bk-ded\">" + lines(book.dedication) + "</div>" : "")
    + "<div class=\"bk-copy\">" + lines(book.copyright || "") + "</div></div>";
  return [frontPage(st, measure, 1, tp, "title"), frontPage(st, measure, 2, back, "back")];
}

/* --------------------------------------------------------- whole book */
// The last finished layout of the body, for the incremental relayout after an edit.
let LAYOUT_CACHE = null, LAYOUT_SEQ = 0;
const blockSig = (B) => JSON.stringify(B, (k, v) => k === "uid" ? undefined : v);
async function layoutBook(book, st, measure, cancelled, onProgress, opt){
  const seq = ++LAYOUT_SEQ;
  await fontsReady(st);
  const metrics = measureMetrics(st, measure);
  const blocks = buildBlocks(book, st);
  // Same style and measurements as last time? Then the pages before the first changed
  // block stay as they were. (uids of the unchanged blocks are kept, so the table of
  // contents still finds its headings on the reused pages.)
  const key = JSON.stringify(st) + "|" + JSON.stringify(metrics) + "|orn" + (typeof ORN_GEN === "number" ? ORN_GEN : 0);   // v1.8.98: pages drawn before the real ornaments arrived are not reused
  const sigs = blocks.map(blockSig);
  const LC = !(opt && opt.full) && LAYOUT_CACHE && LAYOUT_CACHE.key === key ? LAYOUT_CACHE : null;
  let firstChanged = 0;
  if(LC){
    while(firstChanged < sigs.length && firstChanged < LC.sigs.length && sigs[firstChanged] === LC.sigs[firstChanged]){
      blocks[firstChanged].uid = LC.uids[firstChanged];
      firstChanged++;
    }
  }
  const runs = {};
  // the daf of every section for the running head ("מכות דף ה׳ ע״א"); a section with no
  // daf of its own goes on with the one before it
  const dafs = {}, mas = String(book.masechet || "").trim();
  let curDaf = "";
  for(const s of (book.sections || [])){
    const d = dafLabel(s, st.dafFormat);
    if(d) curDaf = d;
    dafs[s.id] = curDaf ? (mas ? mas + " " + curDaf : curDaf) : "";
  }
  const opts = (bl, startNo) => ({st, blocks:bl, measure, startNo, cancelled, metrics, dafs,
    bookTitle: String(book.title || "").trim(), onProgress: (k) => onProgress && onProgress(k + startNo - 1)});
  let front = [];
  if(st.titlePage && String(book.title || "").trim()) front = titlePages(book, st, measure);
  const firstNo = front.length + 1;
  const entries = blocks.filter(b => b.toc);
  const hasChap = entries.some(b => b.toc === 1);
  const useSim = st.tocSimanim === "yes" || (st.tocSimanim === "auto" && entries.filter(b => b.toc === 2).length <= 80);
  const tocList = entries.filter(b => b.toc !== 2 || useSim || !hasChap);
  const tocBlocks = (nums) => {
    const out = [{t:"h1", label:"", title:"תוכן העניינים", hdr:"תוכן העניינים", newPage:true, reset:"chapter", uid:"htoc"}];
    for(const b of tocList) out.push({t:"toc", lvl: b.toc === 0 ? 0 : (b.toc === 2 && hasChap ? 2 : 1), title: b.tocTitle || b.title || "", num: nums ? (nums[b.uid] || "") : "תתקצט", uid:b.uid, link:true});
    return out;
  };
  const numFmt = (n) => st.pageNumbers === "digits" ? String(n) : gem(n);
  const doBody = async (startNo) => {
    const prev = LC && LC.runs[startNo];
    let resume = null;
    if(prev){
      let c = null;
      for(const x of prev.ckpts){ if(x.i <= firstChanged && x.i > 0) c = x; else if(x.i > firstChanged) break; }
      if(c) resume = {i:c.i, pages:prev.pages.slice(0, c.pages).map(P => P.snap), cnt:c.cnt, carry:c.carry, hdr:c.hdr,
        cur:c.cur, ckpts:prev.ckpts.filter(x => x.i <= c.i)};
    }
    const pg = new Paginator(Object.assign(opts(blocks, startNo), {resume}));
    const pages = await pg.run();
    runs[startNo] = {ckpts: pg.ckpts, pages};
    return pages;
  };
  const numsOf = (pages) => {
    const nums = {};
    for(const P of pages) for(const hd of P.heads) if(hd.B.uid && nums[hd.B.uid] == null) nums[hd.B.uid] = numFmt(P.n);
    return nums;
  };
  let tocPages = [], body;
  const wantToc = st.toc !== "none" && tocList.length >= 2;
  if(wantToc && st.toc === "start"){
    tocPages = await new Paginator(opts(tocBlocks(null), firstNo)).run();
    body = await doBody(firstNo + tocPages.length);
    let t2 = await new Paginator(opts(tocBlocks(numsOf(body)), firstNo)).run();
    if(t2.length !== tocPages.length){
      body = await doBody(firstNo + t2.length);
      t2 = await new Paginator(opts(tocBlocks(numsOf(body)), firstNo)).run();
    }
    tocPages = t2;
  }else{
    body = await doBody(firstNo);
    if(wantToc) tocPages = await new Paginator(opts(tocBlocks(numsOf(body)), firstNo + body.length)).run();
  }
  // B1: the index of sources, built from the finished body pages, printed at the very end
  let ixPages = [];
  if(st.index){
    const ixb = indexBlocks(body, numFmt);
    if(ixb) ixPages = await new Paginator(opts(ixb, firstNo + tocPages.length + body.length)).run();
  }
  const pages = (st.toc === "start" ? front.concat(tocPages, body) : front.concat(body, tocPages)).concat(ixPages);
  pages.forEach((P, i) => { P.idx = i; });
  // catchwords: the first word of the next page, bottom-left
  if(st.catchword){
    for(let i = 0; i < pages.length - 1; i++){
      const P = pages[i], Q = pages[i + 1];
      if(P.kind !== "body" || Q.kind !== "body") continue;
      const first = Q.el.querySelector(".bk-flow > *");
      if(!first) continue;
      const c = first.cloneNode(true);
      c.querySelectorAll(".bk-mk,.bk-horn").forEach(x => x.remove());
      const w = (c.textContent || "").trim().split(/\s+/)[0] || "";
      const slot = P.el.querySelector(".bk-catch");
      if(slot) slot.textContent = w;
    }
  }
  let words = 0, notes = 0;
  for(const b of blocks) if(b.t === "p"){ words += b.toks.length; notes += b.notes.length; }
  // only a run that was neither cancelled nor overtaken by a newer one is kept for reuse
  if(!(opt && opt.nocache) && !cancelled() && seq === LAYOUT_SEQ) LAYOUT_CACHE = {key, sigs, uids: blocks.map(b => b.uid), runs};
  return {pages, words, notes};
}

/* ================================================================== UI === */
let ROOT = null, book = null, st = null, openSec = null, dirty = false, saving = false;
let lastPages = [], layoutGen = 0, layoutPromise = null, viewMode = lsGet("bk_view", "spread");
let userZoom = parseFloat(lsGet("bk_zoom", "1")) || 1, undoSec = null, undoTimer = null, followSec = null;
let currentTab = "content";
// v1.8.99: the tall side rail (Eli 03.11, "סרגל צד ארוך שממנו יפתחו האפשרויות")
const RAIL_TOPICS = [
  ["content", "📝", "תוכן", "content", "bkTabContentBtn"],
  ["ready", "⭐", "עיצובים מוכנים", "design", ""],
  ["page", "📄", "העמוד", "design", ""],
  ["para", "¶", "פסקאות", "design", ""],
  ["heads", "🏷", "כותרות", "design", ""],
  ["notes", "¹", "הערות", "design", ""],
  ["top", "🔢", "ראש העמוד", "design", ""],
  ["all", "🎨", "כל העיצוב", "design", "bkTabDesignBtn"],
  ["styles", "🖋", "רכיבים", "styles", "bkTabStylesBtn"],
  ["details", "📘", "פרטי הספר", "details", "bkTabDetailsBtn"],
  ["tools", "🧰", "כלים", "tools", ""]
];
const RAIL_SUB = {content:"קטעים, כתיבה, הערות", ready:"סוג הספר ועיצוב מוכן בלחיצה", page:"גודל, שוליים, טורים, אותיות", para:"הזחה, פתיחה, סעיפים, דיבור המתחיל",
  heads:"צורת הכותרות", notes:"הערות בתחתית העמוד", top:"כותרת עליונה ומספרי עמודים", all:"כל הגדרות העיצוב במקום אחד", styles:"איך כל רכיב נראה", details:"שם הספר, מחבר, שער"};
// which design sections (by their heading) each topic shows
const RAIL_SECT = {ready:["חידושים"], page:["העמוד"], para:["פסקאות", "סימנים"], heads:["צורת הכותרות"], notes:["הערות"], top:["כותרות ומספרי"]};
let currentTopic = "content", railOpen = true, railNarrow = lsGet("bk_rail", "") === "narrow";

function newBook(){
  const d = new Date();
  const p2 = (x) => String(x).padStart(2, "0");
  const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "_" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  return {v:1, id:"book_" + stamp + "_" + Math.random().toString(36).slice(2, 6), title:"", subtitle:"", author:"",
    place:"", year:"", dedication:"", copyright:"כל הזכויות שמורות למחבר",
    sections:[{id:uid("s"), kind:"chapter", title:"", text:""}], style:Object.assign({}, DEFAULT_STYLE), created:Date.now() / 1000};
}
// the book Abba works on most: opened most often here (counted per book), else the one with most pages
function bumpOpenCount(id){
  try{ const c = JSON.parse(lsGet("bk_opens", "{}") || "{}"); c[id] = (Number(c[id]) || 0) + 1; lsSet("bk_opens", JSON.stringify(c)); }catch(e){}
}
async function mainBookStyle(excludeId){
  let list = [];
  try{ list = (await call("/api/book/list")).books || []; }catch(e){ return null; }
  let opens = {};
  try{ opens = JSON.parse(lsGet("bk_opens", "{}") || "{}"); }catch(e){}
  const cand = list.filter(b => (Number(b.pages) || 0) > 1 && b.id !== excludeId);
  if(!cand.length) return null;
  cand.sort((a, b) => ((Number(opens[b.id]) || 0) - (Number(opens[a.id]) || 0)) || ((Number(b.pages) || 0) - (Number(a.pages) || 0)) || ((b.updated || 0) - (a.updated || 0)));
  try{
    const src = normalize((await call("/api/book/load?id=" + encodeURIComponent(cand[0].id))).book);
    const style = JSON.parse(JSON.stringify(src.style));
    delete style.tp;                      // a new book starts with its own (classic) title page
    return {style, title: src.title || "ספר ללא שם"};
  }catch(e){ return null; }
}
// v1.8.89 (Eli 11-02: "לתקן מהשורש — התוכנה נבנתה מותאמת לעושה חיל"): a new book no longer copies the design of
// the book opened most (עושה חיל). It asks once WHAT book it is, and takes that type's own design and its own
// kind of parts. "Like עושה חיל" is one choice in the list, not what every book gets.
const BOOK_TYPES = [
  {k:"chidushim", icon:"📚", name:"חידושים ושיעורים", desc:"כמו עושה חיל: כל פסקה פותחת במילה מודגשת, שני טורים", like:"ose",
   set:Object.assign({}, DAF_COMMON), part:"chapter", ps:[{id:"quote", name:"ציטוט"}, {id:"small", name:"קטן"}, {id:"center", name:"במרכז"}, {id:"bold", name:"מודגש"}]},
  {k:"torah", icon:"📜", name:"פירוש על התורה", desc:"פסוק ואחריו הפירוש: הפסוק במרכז ומודגש, הפירוש פותח עד הנקודתיים", torah:true,
   set:{bodyFont:"b:frank", bodySize:11, lineHeight:1.45, margins:"normal", chapterWord:"פרשת", autoNumber:false, chapterNewPage:true}, part:"chapter",
   ps:[{id:"pasuk", name:"פסוק"}, {id:"perush", name:"פירוש"}, {id:"quote", name:"ציטוט"}, {id:"small", name:"קטן"}]},
  {k:"halacha", icon:"⚖", name:"הלכה ועיון", desc:"טור אחד, פסקאות עם רווח, כותרות משנה מודגשות; טקסט ומפרשים בשמם — בלי \"פרק א\" שנוסף לבד",
   set:{bodyFont:"b:frank", bodySize:12, lineHeight:1.5, opener:"none", paraStyle:"gap", autoNumber:false, chapterNewPage:false,
        numLabels:true, digitHang:false, subCenter:false, noteFont:"b:rashi", noteSize:9.5, noteCols:2, noteMarker:"paren", notesNumbering:"siman"}, part:"text",
   ps:[{id:"main", name:"טקסט"}, {id:"mefaresh", name:"מפרש"}, {id:"quote", name:"ציטוט"}, {id:"small", name:"קטן"}]},
  {k:"shut", icon:"❓", name:"שאלות ותשובות", desc:"כל סימן: השאלה ואחריה התשובה, \"סימן א\" מעל כל אחד",
   set:{columns:2, bodyFont:"b:rashi", bodySize:11, lineHeight:1.42, opener:"none", paraStyle:"none", simanWord:"סימן", autoNumber:true,
        simanLook:"classic", chapterNewPage:false, numLabels:true, numSize:"big", bodyDibur:true, emphSquare:true, headerMode:"split"}, part:"siman",
   ps:[{id:"q", name:"שאלה"}, {id:"a", name:"תשובה"}, {id:"quote", name:"ציטוט"}]},
  {k:"plain", icon:"📖", name:"ספר רגיל עם פרקים", desc:"טור אחד, פרק א, פרק ב — כל פרק בעמוד חדש",
   set:{bodyFont:"b:frank", bodySize:12.5, lineHeight:1.55, opener:"none", paraStyle:"indent", autoNumber:true, chapterWord:"פרק"}, part:"chapter",
   ps:[{id:"quote", name:"ציטוט"}, {id:"center", name:"במרכז"}, {id:"small", name:"קטן"}]},
  {k:"booklet", icon:"🕯", name:"חוברת לשבת", desc:"גודל 14×21, טור אחד — נוח להדפסה ולחלוקה",
   set:{pageSize:"140x210", pageW:140, pageH:210, bodyFont:"b:frank", bodySize:11.5, lineHeight:1.5, opener:"bold", paraStyle:"gap",
        noteFont:"b:rashi", noteSize:8.8, noteCols:1, notesNumbering:"book", autoNumber:false, chapterNewPage:false}, part:"text",
   ps:[{id:"title2", name:"כותרת קטנה"}, {id:"quote", name:"ציטוט"}, {id:"center", name:"במרכז"}]},
];
// the design of a type, as a full style object (the text never changes)
async function bookTypeStyle(T){
  const style = Object.assign({}, DEFAULT_STYLE, TEMPLATE_BASE, T.set);
  if(T.torah) applyTorahLook(style);
  if(T.like === "ose"){
    // only when Abba picks "like עושה חיל": his own עושה חיל book, exactly
    try{
      const list = (await call("/api/book/list")).books || [];
      const ose = list.find(x => /עו?שה\s*חיל/.test(String(x.title || "")));
      if(ose){ const src = normalize((await call("/api/book/load?id=" + encodeURIComponent(ose.id))).book);
        Object.assign(style, JSON.parse(JSON.stringify(src.style))); delete style.tp; }
    }catch(e){}
  }
  if(T.ps) style.pstyles = T.ps.map(x => Object.assign({}, x));
  style.bookType = T.k;
  return style;
}
async function newBookOfType(k){
  const T = BOOK_TYPES.find(x => x.k === k) || BOOK_TYPES.find(x => x.k === "plain");
  const b = newBook();
  b.style = await bookTypeStyle(T);
  b.sections = [{id:uid("s"), kind:T.part, title:"", text:""}];
  return b;
}
// set the type of the open book (its text stays; an empty first part takes the type's kind)
async function setBookType(k){
  const T = BOOK_TYPES.find(x => x.k === k); if(!T || !book) return;
  const tp = st.tp;
  const style = await bookTypeStyle(T);
  const used = new Set([].concat(...(book.sections || []).map(s => Object.values(s.pst || {}))));
  const oldList = psList();
  const list = psList(style).map(x => Object.assign({}, x));
  for(const id of used) if(!list.some(x => x.id === id)){ const o = oldList.find(x => x.id === id); list.push({id, name: o ? o.name : id}); }
  style.pstyles = list;
  const keepEl = {}; for(const k of Object.keys(st.el || {})) if(/^ps_/.test(k)) keepEl[k] = st.el[k];
  style.el = Object.assign({}, style.el || {}, keepEl);
  for(const key of Object.keys(st)) delete st[key];
  Object.assign(st, style); if(tp) st.tp = tp; else delete st.tp;
  if(book.sections.length === 1 && !String(book.sections[0].text || "").trim() && !String(book.sections[0].title || "").trim()) book.sections[0].kind = T.part;
  markDirty(); styleChanged(true); renderContent();
  toast("✓ " + T.icon + " " + T.name + " — העיצוב של הסוג הזה הוחל. אפשר לשנות כל דבר בלשונית העיצוב, ולבטל עם ↶", "ok");
}
function bookTypeCards(cur, attr){
  return `<div class="bk-types">${BOOK_TYPES.map(T => `<button type="button" class="bk-type${cur === T.k ? " on" : ""}" ${attr}="${T.k}">
    <span class="bk-type-i">${T.icon}</span><b>${T.name}</b><small>${T.desc}</small></button>`).join("")}</div>`;
}
function bookTypeDialog(onPick){
  const D = modal(`<header><h3>איזה ספר זה?</h3></header>
  <div class="bk-dbody"><p class="bk-tpnote">כל סוג מקבל את העיצוב שמתאים לו. אפשר לשנות הכל אחר כך בלשונית העיצוב.</p>${bookTypeCards("", "data-btype")}</div>
  <footer><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelectorAll("[data-btype]").forEach(b => b.addEventListener("click", () => { closeModal(); onPick(b.dataset.btype); }));
}
// (kept only for the "📖 לעצב כמו הספר שאני עובד עליו" button — an explicit choice, never automatic)
async function newBookLikeMain(){
  const b = newBook();
  const m = await mainBookStyle();
  if(m) b.style = Object.assign({}, DEFAULT_STYLE, m.style);
  return {b, from: m && m.title};
}
// paragraph settings need paragraphs: choosing one while the lines are joined brings the paragraphs back
function needParas(){
  if(st && st.paraJoin === "section"){
    st.paraJoin = "";
    toast("החזרתי את הזיהוי האוטומטי של פסקאות, אחרת ההגדרה הזו לא נראית", "ok");
  }
}
const PARA_KEYS = ["paraStyle", "opener", "openerEvery", "digitHang", "numLabels", "entryGap"];
function normalize(b){
  b = Object.assign(newBook(), b || {});
  b.style = Object.assign({}, DEFAULT_STYLE, b.style || {});
  if(!Array.isArray(b.sections) || !b.sections.length) b.sections = [{id:uid("s"), kind:"chapter", title:"", text:""}];
  b.sections = b.sections.map(s => {
    const o = {id: s.id || uid("s"), kind: KIND_LABEL[s.kind] ? s.kind : "text", title: String(s.title || ""), text: String(s.text || "")};
    if(s.adj && typeof s.adj === "object" && Object.keys(s.adj).length) o.adj = Object.assign({}, s.adj);
    if(SEC_LOOK_CLS[s.look]) o.look = s.look;
    if(s.newPage) o.newPage = true;
    // v1.8.94: per part — columns, opening page, running head, page numbers; per line — alignment, spacing, keep, no number
    if(s.cols === 1 || s.cols === 2) o.cols = s.cols;
    if(s.oddPage) o.oddPage = true;
    if(s.head && String(s.head).trim()) o.head = String(s.head).trim().slice(0, 120);
    if(Number(s.pnumStart) > 0) o.pnumStart = Math.min(9999, Math.round(Number(s.pnumStart)));
    for(const k of ["align", "space", "keep", "noPnum", "fmt"]) if(s[k] && typeof s[k] === "object" && Object.keys(s[k]).length) o[k] = JSON.parse(JSON.stringify(s[k]));
    if(s.hfmt && typeof s.hfmt === "object" && Object.keys(s.hfmt).length) o.hfmt = JSON.parse(JSON.stringify(s.hfmt));
    if(s.pst && typeof s.pst === "object" && Object.keys(s.pst).length) o.pst = Object.assign({}, s.pst);
    const daf = parseInt(s.daf, 10);
    if(daf > 0 && daf <= 200){ o.daf = daf; if(s.amud === "א" || s.amud === "ב") o.amud = s.amud; }
    return o;
  });
  b.style.el = JSON.parse(JSON.stringify(b.style.el || {}));
  b.images = b.images && typeof b.images === "object" ? b.images : {};
  if(b.style.tp) b.style.tp = Array.isArray(b.style.tp.lines) ? JSON.parse(JSON.stringify(b.style.tp)) : null;
  return b;
}
function hasText(b){ return (b.sections || []).some(s => String(s.text || "").trim()); }
function countNotes(t){ return (String(t || "").match(/\{[^{}]+\}/g) || []).length; }
function firstWords(t, n){ const w = String(t || "").replace(/\{\{.*?\}\}|\{.*?\}|[*#=]/g, " ").trim().split(/\s+/).slice(0, n || 7).join(" "); return w; }

async function call(url, opts){
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {}, {"X-Mishkenotecha-Token": APP.token});
  const res = await fetch(url, Object.assign({}, opts, {headers}));
  let data = {};
  try{ data = await res.json(); }catch(e){}
  if(!res.ok) throw new Error(data.error || ("שגיאה " + res.status));
  return data;
}
async function postJSON(url, obj){
  return call(url, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(obj)});
}

/* ---------------------------------------------------------------- saving */
function setSaveState(text, err){
  const el = $("bkSave");
  if(!el) return;
  el.textContent = text;
  el.classList.toggle("err", !!err);
}
const saveSoon = debounce(() => saveNow(), 1200);
function markDirty(){ dirty = true; setSaveState("שומר…"); saveSoon(); histSoon(); }
// Undo / redo over everything: text, structure, styles. A snapshot is taken a moment
// after each change (typing is grouped by pauses).
const HIST = {stack:[], idx:-1, timer:null, last:"", busy:false};
// meta (page/word counts) is rewritten by every layout: it is not an edit
function histJSON(){ return JSON.stringify(book, (k, v) => k === "meta" ? undefined : v); }
function histLimit(len){ return len > 2e6 ? 25 : (len > 5e5 ? 60 : 150); }
function histCapture(){
  if(!book || HIST.busy) return;
  clearTimeout(HIST.timer); HIST.timer = null;
  const j = histJSON();
  if(j === HIST.last) return;
  HIST.stack = HIST.stack.slice(0, HIST.idx + 1);
  HIST.stack.push({j, open: openSec});
  const lim = histLimit(j.length);
  while(HIST.stack.length > lim) HIST.stack.shift();
  HIST.idx = HIST.stack.length - 1;
  HIST.last = j;
  syncHist();
}
function histSoon(){ if(HIST.busy) return; clearTimeout(HIST.timer); HIST.timer = setTimeout(histCapture, 600); }
function histReset(){ HIST.stack = []; HIST.idx = -1; HIST.last = ""; histCapture(); }
function syncHist(){
  const u = $("bkUndoBtn"), r = $("bkRedoBtn");
  if(u) u.disabled = HIST.idx <= 0;
  if(r) r.disabled = HIST.idx >= HIST.stack.length - 1;
}
function rerenderAll(){
  renderTop(); renderContent();
  if(currentTab === "design") renderDesign();
  if(currentTab === "details") renderDetails();
  if(currentTab === "styles") renderStyles();
}
// an open dialog that shows the book (the שער pages) redraws itself after ↶ / ↷
let modalRefresh = null;
function histRestore(entry){
  const ta = ROOT.querySelector(".bk-sec.open textarea");
  const caret = ta && document.activeElement === ta ? ta.selectionStart : null, sc = ta ? ta.scrollTop : 0;
  HIST.busy = true;
  try{
    const meta = book.meta, wasOpen = openSec;
    book = normalize(JSON.parse(entry.j)); st = book.style;
    // stay in the section being edited when it still exists
    openSec = book.sections.some(x => x.id === wasOpen) ? wasOpen : entry.open;
    if(meta) book.meta = meta;
    rerenderAll();
    dirty = true; setSaveState("שומר…"); saveSoon(); scheduleLayout(150);
  }finally{ HIST.busy = false; }
  HIST.last = histJSON();
  HIST.stack[HIST.idx] = {j: HIST.last, open: openSec};
  const t2 = ROOT.querySelector(".bk-sec.open textarea");
  if(t2 && caret != null){ t2.focus({preventScroll:true}); const c = Math.min(caret, t2.value.length); t2.setSelectionRange(c, c); t2.scrollTop = sc; }
  syncHist();
  if(modalRefresh && !$("bkModal").hidden) modalRefresh();
}
function undo(){
  histCapture();
  if(HIST.idx <= 0){ toast("אין עוד מה לבטל", "warn"); return; }
  HIST.idx--; histRestore(HIST.stack[HIST.idx]);
}
function redo(){
  if(HIST.idx >= HIST.stack.length - 1){ toast("אין מה להחזיר", "warn"); return; }
  HIST.idx++; histRestore(HIST.stack[HIST.idx]);
}
async function saveNow(){
  if(!book || !dirty || saving) return;
  saving = true; dirty = false;
  try{
    await postJSON("/api/book/save", {book});
    lsSet("bk_last", book.id);
    setSaveState(dirty ? "שומר…" : "נשמר ✓");
  }catch(e){
    dirty = true;
    setSaveState("לא נשמר — אנסה שוב", true);
    setTimeout(() => { if(dirty) saveNow(); }, 5000);
  }finally{
    saving = false;
    if(dirty) saveSoon();
  }
}

/* ---------------------------------------------------------------- layout */
let layoutTimer = null, needLayout = false;
function scheduleLayout(ms){
  clearTimeout(layoutTimer);
  layoutTimer = null;
  if(ms === 0){ relayout(); return; }
  layoutTimer = setTimeout(relayout, ms == null ? 650 : ms);
}
// v1.8.87 (Abba: "המילה הראשונה גבוהה יותר מהשורה"): the "window" first word is a float in a bigger
// size (and any font Abba picks), so its baseline does not fall on the line's. After the fonts are in,
// both baselines are measured on a sample and the word is moved by the difference — position:relative,
// so the layout itself does not change. Holds for every font, size and line height.
let WIN_SHIFT = 0;   // in em of the window word
function alignWindowOpener(){
  const M = $("bkMeasure");
  if(!M || !st) return;
  const pr = h("div", {class:"bk-page"});
  pr.style.cssText = "position:absolute;visibility:hidden;top:0;right:0;width:120mm";
  pr.innerHTML = '<div class="bk-body"><div class="bk-flow"><p class="bk-p"><span class="bk-open window">אבג<i class="bkq"></i></span> דהו<i class="bkq"></i> זחט</p></div></div>';
  pr.querySelectorAll(".bkq").forEach(q => q.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline");
  M.appendChild(pr);
  try{
    const q = pr.querySelectorAll(".bkq"), o = pr.querySelector(".bk-open");
    const diff = q[1].getBoundingClientRect().bottom - q[0].getBoundingClientRect().bottom;   // > 0: the word sits too high
    const fs = parseFloat(getComputedStyle(o).fontSize) || 0;
    if(fs && Math.abs(diff) > 0.05){ WIN_SHIFT = Math.round((WIN_SHIFT + diff / fs) * 1000) / 1000; injectPageCSS(); }
  }catch(e){}
  pr.remove();
}
function injectPageCSS(){
  let s = $("bkPageCss");
  if(!s){ s = h("style", {id:"bkPageCss"}); document.head.appendChild(s); }
  s.textContent = pageCSS(st, "/book/font/", {side: sideMargin(book, st)});
}
function setBusy(text){
  const el = $("bkBusy");
  if(el){ el.textContent = text || ""; el.hidden = !text; }
}
async function relayout(){
  if(!book || !ROOT) return;
  // a hidden studio has no layout box: measuring would give zeros
  if(!ROOT.classList.contains("on")){ needLayout = true; return; }
  needLayout = false;
  const gen = ++layoutGen;
  injectPageCSS();
  setBusy("מעמד את הספר…");
  const run = (async () => {
    try{
      const res = await layoutBook(book, st, $("bkMeasure"), () => gen !== layoutGen,
        (k) => setBusy("מעמד… " + k + " עמודים"));
      if(gen !== layoutGen) return;
      lastPages = res.pages;
      fillDetect();
      if(document.getElementById("bkSample") && st) showSample(st.paraStyle, st.opener, "כך זה נראה עכשיו:");
      alignWindowOpener();
      showPages();
      refreshSearchAfterLayout();
      const meta = {pages: res.pages.length, words: res.words, notes: res.notes};
      book.meta = meta;
      // only the page count: Eli's father found the word count confusing and unreliable
      const stat = $("bkStat");
      if(stat) stat.textContent = "מתוך " + res.pages.length;
      syncBracketWarn();
      setBusy("");
    }catch(e){
      if(e === CANCELLED) return;
      console.error(e);
      setBusy("");
      toast("שגיאה בעימוד: " + (e && e.message || e), "err");
    }
  })();
  layoutPromise = run;
  return run;
}
async function waitLayout(){
  for(let i = 0; i < 100; i++){
    const p = layoutPromise;
    await p;
    if(p === layoutPromise) return;
  }
}
function slotScale(){
  const V = $("bkViewer");
  const g = geometry(st);
  const pw = g.W * MM;
  const avail = Math.max(240, (V.clientWidth || 800) - 48);
  const fit = viewMode === "spread" ? avail / (2 * pw) : Math.min(avail / pw, 1.5);
  return Math.max(0.18, Math.min(3, fit * userZoom));
}
function topVisibleIndex(){
  const V = $("bkViewer");
  if(!V) return 0;
  const top = V.getBoundingClientRect().top;
  const slots = V.querySelectorAll(".bk-slot[data-idx]");
  for(const s of slots){ if(s.getBoundingClientRect().bottom > top + 30) return parseInt(s.dataset.idx, 10) || 0; }
  return 0;
}
function showPages(){
  const V = $("bkViewer");
  if(!V || !book || !st) return;
  const keep = V.querySelector(".bk-slot[data-idx]") ? topVisibleIndex() : 0;
  const prevScroll = V.scrollTop;
  V.innerHTML = "";
  if(!hasText(book)){ V.appendChild(welcomeCard()); }
  const g = geometry(st);
  const pw = g.W * MM, ph = g.H * MM;
  const s = slotScale();
  const slot = (P, side) => {
    const sl = h("div", {class:"bk-slot" + (side ? " " + side : "")});
    sl.style.width = (pw * s) + "px"; sl.style.height = (ph * s) + "px";
    if(!P){ sl.classList.add("blank"); return sl; }
    const sc = h("div", {class:"bk-scale"});
    sc.style.transform = "scale(" + s + ")";
    sc.appendChild(P.el);
    sl.appendChild(sc);
    sl.appendChild(h("div", {class:"bk-pglabel"}, "עמוד " + P.n));
    sl.dataset.idx = P.idx;
    return sl;
  };
  if(viewMode === "spread"){
    const bySpread = new Map();
    for(const P of lastPages){
      const k = Math.floor(P.n / 2);
      if(!bySpread.has(k)) bySpread.set(k, {});
      bySpread.get(k)[P.odd ? "l" : "r"] = P;
    }
    for(const k of [...bySpread.keys()].sort((a, b) => a - b)){
      const sp = bySpread.get(k);
      const row = h("div", {class:"bk-spread"});
      row.appendChild(slot(sp.r, "r"));
      row.appendChild(slot(sp.l, "l"));
      V.appendChild(row);
    }
  }else{
    for(const P of lastPages){ const row = h("div", {class:"bk-spread"}); row.appendChild(slot(P)); V.appendChild(row); }
  }
  if(HERE) markHere(HERE.sec, HERE.ln);
  if(followSec){ const id = followSec; followSec = null; scrollToSection(id); }
  else if(keep){ const t = V.querySelector(".bk-slot[data-idx=\"" + keep + "\"]"); if(t){ V.style.scrollBehavior = "auto"; t.scrollIntoView({block:"start"}); V.scrollTop -= 14; V.style.scrollBehavior = ""; } }
  else V.scrollTop = Math.min(prevScroll, V.scrollHeight);
}
function scrollToSection(id){
  const P = lastPages.find(x => x.secs && x.secs.includes(id));
  if(!P) return;
  const sl = $("bkViewer").querySelector(".bk-slot[data-idx=\"" + P.idx + "\"]");
  if(sl){
    sl.scrollIntoView({block:"start", behavior:"smooth"});
    const target = P.el.querySelector("[data-sec=\"" + id + "\"]");
    if(target){ target.classList.remove("bk-flash"); void target.offsetWidth; target.classList.add("bk-flash"); }
  }
}
function gotoPage(n){
  const P = lastPages.find(x => x.n === n);
  if(!P){ toast("אין עמוד " + n, "warn"); return; }
  const sl = $("bkViewer").querySelector(".bk-slot[data-idx=\"" + P.idx + "\"]");
  if(sl) sl.scrollIntoView({block:"start", behavior:"smooth"});
}

/* ------------------------------------------------------------- DOM build */
function buildDOM(){
  ROOT = h("div", {id:"bkRoot", class:"bk-root", role:"dialog", "aria-modal":"true", "aria-label":"עימוד ספר"});
  ROOT.innerHTML = `
<header class="bk-top">
  <div class="bk-brand"><span class="bk-logo">📖</span><span>עימוד ספר</span><span class="bk-booktitle" id="bkTopTitle"></span></div>
  <span class="bk-save" id="bkSave">נשמר ✓</span>
  <div class="bk-undobar" role="group" aria-label="ביטול">
    <button class="bk-btn bk-ub" id="bkTopUndo" type="button" title="בטל (Ctrl+Z)" aria-label="בטל">↶ <span>בטל</span></button>
    <button class="bk-btn bk-ub" id="bkTopRedo" type="button" title="החזר (Ctrl+Y)" aria-label="החזר">↷ <span>החזר</span></button>
  </div>
  <div class="bk-ts" role="group" aria-label="גודל הכתב במסך">
    <button class="bk-btn bk-tsb" id="bkTsDown" type="button" title="כתב קטן יותר במסך (הספר עצמו לא משתנה)" aria-label="כתב קטן יותר">א−</button>
    <span class="bk-tsl" id="bkTsLabel"></span>
    <button class="bk-btn bk-tsb" id="bkTsUp" type="button" title="כתב גדול יותר במסך (הספר עצמו לא משתנה)" aria-label="כתב גדול יותר">א+</button>
  </div>
  <div class="bk-top-actions">
    <div class="bk-menu" id="bkMenu">
      <button class="bk-btn" id="bkMenuBtn" type="button" aria-haspopup="menu" aria-expanded="false" title="כל הפעולות: PDF, ביטול, גרסאות, הספרים שלי ועוד">☰ אפשרויות נוספות ▾</button>
      <div class="bk-menulist" id="bkMenuList" role="menu" hidden>
        <button type="button" role="menuitem" class="bk-mi-pdf" id="bkPdfBtn"><span>📄 הפק PDF להדפסה</span><small>Ctrl+P</small></button>
        <button type="button" role="menuitem" id="bkDocxBtn"><span>📝 שמור כקובץ Word</span></button>
        <button type="button" role="menuitem" class="bk-mi-report" id="bkReportBtn">💬 דיווח על תקלה או רעיון</button>
        <hr/>
        <button type="button" role="menuitem" id="bkUndoBtn"><span>↶ בטל את הפעולה האחרונה</span><small>Ctrl+Z</small></button>
        <button type="button" role="menuitem" id="bkRedoBtn"><span>↷ החזר את מה שבוטל</span><small>Ctrl+Y</small></button>
        <button type="button" role="menuitem" id="bkHelpBtn" aria-pressed="false">💡 הצג הסברים</button>
        <button type="button" role="menuitem" id="bkSimpleBtn" aria-pressed="true">🧩 מצב פשוט (פחות כפתורים)</button>
        <button type="button" role="menuitem" id="bkLooksBtn">🎨 צבעי המסך</button>
        <button type="button" role="menuitem" class="bk-simple-only" id="bkFindMenuBtn"><span>🔍 חיפוש מילה בספר</span><small>Ctrl+F</small></button>
        <button type="button" role="menuitem" class="bk-simple-only" id="bkViewMenuBtn">📖 שני עמודים / עמוד אחד</button>
        <button type="button" role="menuitem" id="bkVersionsBtn">🕘 גרסאות קודמות של הספר</button>
        <button type="button" role="menuitem" id="bkBooksBtn">📚 הספרים שלי</button>
        <button type="button" role="menuitem" id="bkToolsBtn"><span>🔍 חיפוש והחלפה ועוד כלים</span><small>Ctrl+H</small></button>
        <button type="button" role="menuitem" id="bkGuideBtn">❓ מדריך — מה עושה כל כפתור</button>
        <hr/>
        <button type="button" role="menuitem" id="bkCloseBtn">✕ חזרה לתוכנה</button>
      </div>
    </div>
    <button class="bk-btn bk-x" id="bkCloseX" type="button" title="חזרה לתוכנה" aria-label="חזרה לתוכנה">✕</button>
  </div>
</header>
<div class="bk-ribbon" id="bkRibbon" role="toolbar" aria-label="סרגלי כלים"></div>
<div class="bk-main" id="bkMain">
  <aside class="bk-side" id="bkSide" aria-label="עריכת הספר">
    <nav class="bk-rail" role="tablist" aria-label="נושאים" aria-orientation="vertical">
      <div class="bk-railctl"><button type="button" id="bkFnFindBtn" title="חיפוש פונקציה (Ctrl+J)" aria-label="חיפוש פונקציה">🔎 חיפוש</button><button type="button" id="bkRailNarrow" title="צמצם לסמלים" aria-label="צמצם לסמלים">▸◂</button></div>
      ${RAIL_TOPICS.map(([k, ic, l, tab, id]) => `<button class="bk-tab" role="tab" type="button"${id ? ` id="${id}"` : ""} data-tab="${tab}" data-topic="${k}" aria-selected="${k === "content"}" title="${l}"><i aria-hidden="true">${ic}</i><span class="bk-raill">${l}</span></button>`).join("")}
    </nav>
    <div class="bk-sidecol">
      <div class="bk-railhead"><div><b id="bkRailTitle">תוכן</b><small id="bkRailSub">קטעים, כתיבה, הערות</small></div>
        <button type="button" class="bk-railx" id="bkRailClose" aria-label="סגור את הלוח" title="סגור — הסרגל נשאר">✕</button></div>
      <div class="bk-panel" id="bkPanelContent" role="tabpanel"></div>
      <div class="bk-panel" id="bkPanelDesign" role="tabpanel" hidden></div>
      <div class="bk-panel" id="bkPanelStyles" role="tabpanel" hidden></div>
      <div class="bk-panel" id="bkPanelDetails" role="tabpanel" hidden></div>
    </div>
  </aside>
  <div class="bk-divider" id="bkSplit" role="separator" aria-orientation="vertical" tabindex="0"
    aria-label="הגבול בין העריכה לתצוגה" title="גררו כדי להגדיל או להקטין · לחיצה כפולה מחזירה לגודל הרגיל">
    <button class="bk-railbtn" type="button" id="bkSideBtn"></button>
    <button class="bk-railbtn" type="button" id="bkSwapBtn" title="להעביר את חלון העריכה לצד השני של המסך"><span>⇄</span><span class="bk-v">החלף צדדים</span></button>
    <span class="bk-divgrip"></span>
  </div>
  <section class="bk-preview" id="bkPreview" aria-label="תצוגת הספר">
    <div class="bk-pvbar">
      <div class="bk-find" role="search">
        <span class="bk-findbox"><input class="bk-findq" id="bkSearchQ" type="search" placeholder="🔍 חיפוש בספר" aria-label="חיפוש מילה בספר" autocomplete="off" spellcheck="false"/><span class="bk-findn" id="bkSearchN" aria-live="polite"></span></span>
        <button type="button" id="bkSearchPrev" title="המקום הקודם (Shift+Enter)" aria-label="המקום הקודם">▲</button>
        <button type="button" id="bkSearchNext" title="המקום הבא (Enter)" aria-label="המקום הבא">▼</button>
      </div>
      <span class="bk-busy" id="bkBusy" hidden></span>
      <button class="bk-brwarn" type="button" id="bkBrWarn" hidden title="לחצו כדי לראות איפה">⚠</button>
      <span class="bk-sp"></span>
      <div class="bk-pills" role="group" aria-label="איך להציג את העמודים">
        <span class="bk-pvlbl">הצג:</span>
        <button class="bk-pill" type="button" data-view="spread" title="שני עמודים זה מול זה, כמו בספר מודפס">📖 שני עמודים</button>
        <button class="bk-pill" type="button" data-view="single" title="עמוד אחד בכל פעם, גדול יותר">📄 עמוד אחד</button>
      </div>
      <div class="bk-step" role="group" aria-label="גודל התצוגה">
        <button type="button" id="bkZoomOut" aria-label="הקטן תצוגה">−</button><span id="bkZoomLbl">100%</span><button type="button" id="bkZoomIn" aria-label="הגדל תצוגה">+</button>
      </div>
      <label title="הקלידו מספר עמוד כדי לעבור אליו">עמוד <input class="bk-goto" id="bkGoto" type="number" min="1" inputmode="numeric"/> <span class="bk-stat" id="bkStat"></span></label>
    </div>
    <div class="bk-pvhelp"><button type="button" class="bk-pvhelp-x" id="bkPvHelpX" title="להסתיר את ההסברים — הדפים יקבלו את כל המקום" aria-label="להסתיר את ההסברים">✕</button>${helpBox("preview")}${helpBox("menu")}</div>
    <div class="bk-viewer" id="bkViewer"></div>
  </section>
</div>
<div class="bk-measure" id="bkMeasure" aria-hidden="true"></div>
<div class="bk-modal" id="bkModal" hidden><div class="bk-dialog" id="bkDialog" role="dialog" aria-modal="true"></div></div>`;
  document.body.appendChild(ROOT);
  // keep the main screen's global handlers (paste-a-scan, drop-a-scan, Esc) out of the studio
  ROOT.addEventListener("paste", e => e.stopPropagation());
  ["dragenter","dragover"].forEach(ev => ROOT.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
  ROOT.addEventListener("drop", e => {
    e.preventDefault(); e.stopPropagation();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) importFile(f);
  });
  ROOT.addEventListener("keydown", onKey);
  $("bkCloseBtn").addEventListener("click", close);
  $("bkCloseX").addEventListener("click", close);
  $("bkToolsBtn").addEventListener("click", showTools);
  $("bkFnFindBtn").addEventListener("click", fnFind);
  $("bkTopUndo").addEventListener("click", () => undo());
  $("bkTopRedo").addEventListener("click", () => redo());
  $("bkDocxBtn").addEventListener("click", () => { hideMenu(); exportDocx(); });
  $("bkGuideBtn").addEventListener("click", guideDialog);
  $("bkReportBtn").addEventListener("click", reportDialog);
  initMenu();
  $("bkBooksBtn").addEventListener("click", showBooks);
  $("bkPdfBtn").addEventListener("click", exportPdf);
  $("bkUndoBtn").addEventListener("click", undo);
  $("bkRedoBtn").addEventListener("click", redo);
  $("bkVersionsBtn").addEventListener("click", showVersions);
  $("bkPanelStyles").addEventListener("click", onStylesClick);
  $("bkPanelStyles").addEventListener("change", onStylesChange);
  $("bkPanelStyles").addEventListener("input", onStylesInput);
  $("bkPreview").addEventListener("click", e => { if(!e.target.closest(".bk-pop")) hidePop(); }, true);
  ROOT.querySelectorAll(".bk-rail .bk-tab").forEach(b => b.addEventListener("click", () => {
    if(b.dataset.tab === "tools"){ const t = $("bkToolsBtn"); if(t) t.click(); return; }
    if(railOpen && currentTopic === b.dataset.topic && !b.id){ railOpen = false; syncRail(); return; }
    setTab(b.dataset.tab, b.dataset.topic);
  }));
  $("bkRailClose").addEventListener("click", () => { railOpen = false; syncRail(); });
  $("bkRailNarrow").addEventListener("click", () => { railNarrow = !railNarrow; lsSet("bk_rail", railNarrow ? "narrow" : ""); syncRail(); });
  syncRail();
  ROOT.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => { viewMode = b.dataset.view; lsSet("bk_view", viewMode); syncViewBar(); showPages(); }));
  $("bkZoomIn").addEventListener("click", () => setZoom(userZoom * 1.15));
  $("bkZoomOut").addEventListener("click", () => setZoom(userZoom / 1.15));
  $("bkBrWarn").addEventListener("click", checkBrackets);
  $("bkGoto").addEventListener("change", e => { const n = parseInt(e.target.value, 10); if(n > 0) gotoPage(n); });
  $("bkViewer").addEventListener("click", onViewerClick);
  $("bkViewer").addEventListener("contextmenu", ev => { if(ev.target.closest && ev.target.closest(".bk-page")){ ev.preventDefault(); onViewerClick(ev); } });
  $("bkPanelContent").addEventListener("click", onContentClick);
  $("bkPanelContent").addEventListener("input", onContentInput);
  $("bkPanelContent").addEventListener("change", onContentChange);
  $("bkPanelContent").addEventListener("toggle", e => { if(e.target.classList && e.target.classList.contains("bk-more")) lsSet("bk_more", e.target.open ? "1" : "0"); }, true);
  $("bkPanelContent").addEventListener("keydown", e => {
    if((e.key === "Enter" || e.key === " ") && e.target.classList.contains("bk-sec-head")){ e.preventDefault(); e.target.click(); }
  });
  $("bkPanelDesign").addEventListener("click", onDesignClick);
  $("bkPanelDesign").addEventListener("change", onDesignChange);
  $("bkPanelDesign").addEventListener("mouseover", e => {
    const p = e.target.closest("[data-k=\"paraStyle\"],[data-k=\"opener\"]");
    if(!p) return;
    const ps = p.dataset.k === "paraStyle" ? p.dataset.v : st.paraStyle, op = p.dataset.k === "opener" ? p.dataset.v : st.opener;
    showSample(ps, op, "אם תבחרו «" + p.textContent.trim() + "» — כך זה ייראה:");
  });
  $("bkPanelDesign").addEventListener("mouseout", e => { if(e.target.closest("[data-k=\"paraStyle\"],[data-k=\"opener\"]")) showSample(st.paraStyle, st.opener, "כך זה נראה עכשיו:"); });
  $("bkPanelDetails").addEventListener("input", onDetailsInput);
  ROOT.addEventListener("click", e => { if(e.target.closest && e.target.closest("#bkPvHelpX")){ lsSet("bk_help", "0"); applyLayoutPrefs(); } });
  $("bkHelpBtn").addEventListener("click", () => { lsSet("bk_help", ROOT.classList.contains("bk-help-on") ? "0" : "1"); applyLayoutPrefs(); });
  $("bkSimpleBtn").addEventListener("click", () => { lsSet("bk_simple", ROOT.classList.contains("bk-simple") ? "0" : "1"); applyLayoutPrefs(); hideMenu();
    toast(ROOT.classList.contains("bk-simple") ? "מצב פשוט: רק הכפתורים העיקריים" : "כל הכפתורים מוצגים", "ok"); });
  $("bkLooksBtn").addEventListener("click", () => { hideMenu(); looksDialog(); });
  $("bkFindMenuBtn").addEventListener("click", () => { hideMenu(); focusSearch(); });
  $("bkViewMenuBtn").addEventListener("click", () => {
    hideMenu();
    viewMode = viewMode === "single" ? "spread" : "single"; lsSet("bk_view", viewMode); syncViewBar(); showPages();
    toast(viewMode === "single" ? "📄 עמוד אחד בכל פעם" : "📖 שני עמודים זה מול זה", "ok");
  });
  $("bkTsDown").addEventListener("click", () => tsStep(-1));
  $("bkTsUp").addEventListener("click", () => tsStep(1));
  tsSync();
  // A4: keyboard shortcuts in the text box (by key position, so they work in a Hebrew layout too)
  $("bkPanelContent").addEventListener("keydown", e => {
    if(!(e.ctrlKey || e.metaKey) || e.altKey || !e.target.matches("textarea.bk-textarea")) return;
    const act = {KeyB:"bold", KeyK:"note", KeyE:"center", KeyG:"sub"}[e.code];
    if(!act) return;
    const card = e.target.closest(".bk-sec");
    const b = card && card.querySelector("[data-act=\"" + act + "\"]");
    if(b){ e.preventDefault(); e.stopPropagation(); b.click(); }
  });
  // A6: where the cursor is, in plain words, under the text box
  for(const ev of ["keyup", "click", "focusin"])
    $("bkPanelContent").addEventListener(ev, e => { if(e.target.matches && e.target.matches("textarea.bk-textarea")) whereAmI(e.target); });
  $("bkPanelContent").addEventListener("click", e => { const g = e.target.closest("[data-gopage]"); if(g){ gotoPage(Number(g.dataset.gopage)); } });
  $("bkSideBtn").addEventListener("click", () => { lsSet("bk_noside", $("bkMain").classList.contains("bk-noside") ? "0" : "1"); applyLayoutPrefs(); showPages(); });
  $("bkSwapBtn").addEventListener("click", () => { lsSet("bk_swap", $("bkMain").classList.contains("bk-swap") ? "0" : "1"); applyLayoutPrefs(); });
  initSplitter();
  initSearch();
  applyLayoutPrefs();
  let rt = null;
  window.addEventListener("resize", () => { if(!ROOT.classList.contains("on")) return; clearTimeout(rt); rt = setTimeout(showPages, 200); });
}

/* ------------------------------------------------ explanations (💡) */
// Plain words for every button. Shown in place when "💡 הצג הסברים" is on, and all
// together in "❓ מדריך" (tools menu).
const HELP = {
  list: ["📑 רשימת הקטעים", [
    ["מה זה קטע", "הספר בנוי מחלקים שכותבים כל אחד לחוד — למשל ההקדמה, פרק א׳, סימן א׳, סימן ב׳. כל חלק כזה נקרא כאן \"קטע\". ברשימת הקטעים כל שורה היא קטע אחד, באותו סדר שבו יודפס בספר."],
    ["סוגי קטעים", "פרק או סימן — מתחיל בכותרת משלו (\"סימן ב׳ – בדין עדים זוממין\"). הקדמה או הסכמה — מתחילה בעמוד חדש, עם הכותרת שלה. שער — עמוד נפרד לבדו (למשל לפני חלק חדש של הספר). \"טקסט בלי כותרת\" — ממשיך מיד את הקטע שלפניו, בלי שום כותרת; טוב כדי לחלק סימן ארוך לכמה חלקים קטנים ונוחים לעריכה, והקורא לא יראה את החלוקה."],
    ["עריכה", "פותח את הקטע כדי לכתוב ולתקן בו. \"סגירה\" סוגר אותו."],
    ["פרק חדש / סימן חדש", "מוסיף קטע חדש עם כותרת: פרק (כותרת גדולה) או סימן (כותרת קטנה)."],
    ["ייבוא", "מכניס טקסט מוכן: מקובץ Word, מהדבקה, או מהדפים שסרקתם בתוכנה."],
    ["כלים", "חיפוש והחלפה בכל הספר, בדיקת סוגריים, הסרת ניקוד."],
    ["➕ הוסף קטע בסוף הספר", "מוסיף קטע ריק בסוף הספר."]]],
  section: ["📝 קטע פתוח", [
    ["סוג הקטע", "קובע איך הקטע יודפס: פרק, סימן, הקדמה, הסכמה, או \"טקסט בלי כותרת\" שממשיך את מה שלפניו."],
    ["כותרת", "השם שיודפס בראש הקטע. אפשר להשאיר ריק."],
    ["מראה כל הקטע", "מראה לקטע הזה בלבד: אותיות קטנות, גדולות, רש\"י, מרובעות, ציטוט מוזח או אפור. כל הפסקאות שלו יודפסו כך, ושאר הספר לא משתנה. למשל: פסוק בקטע אחד, והפירוש שאחריו בקטע נפרד באותיות קטנות."],
    ["דף בגמרא", "על איזה דף הקטע (ועמוד א או ב). במקום שהדף מתחלף יודפס \"דף ה׳ ע״א\" ככותרת משנה, וגם בראש כל עמוד. קטע בלי בחירה ממשיך את הדף שלפניו."],
    ["התיבה הגדולה", "כאן כותבים. כל שורה היא פסקה בספר. כל שינוי נראה מיד בדף."],
    ["📖 כאן מתחיל דף חדש", "שמים את הסמן בטקסט במקום שבו עוברים לדף הבא בגמרא (למשל לדף ד׳ ע״א), ולוחצים. בוחרים את הדף, ומשם יודפס שם הדף ככותרת קטנה וגם בראש העמוד. הטקסט ממשיך רציף."],
    ["＋ הערה", "עומדים עם הסמן במקום הנכון בטקסט, לוחצים, וכותבים את ההערה. היא תודפס למטה בעמוד."],
    ["＋ מראה מקום", "כמו הערה, אבל בסדרה שנייה של הערות (למשל מקורות)."],
    ["ב הדגשה", "מסמנים מילים בעכבר ולוחצים — הן יודפסו מודגשות."],
    ["כותרת משנה", "שורה שתודפס ככותרת קטנה בתוך הקטע."],
    ["כותרת בשוליים", "מילה או שתיים שיודפסו בצד הדף, ליד הפסקה."],
    ["שורה במרכז", "השורה תודפס באמצע הדף."],
    ["✻ מפריד (ב\"עוד עיצוב\")", "מוסיף שורת כוכבים להפרדה."],
    ["▲ / ▼ הזז את הקטע", "מזיזים את כל הקטע מקום אחד למעלה או למטה בספר."],
    ["✂ חתוך כאן לשני קטעים", "שמים את הסמן בטקסט ולוחצים: מה שאחרי הסמן נהיה קטע חדש משלו (למשל כדי לתת לו כותרת של סימן חדש)."],
    ["⤴ צרף לקטע שמעליו", "ההפך מחיתוך: הקטע הזה מצטרף לסוף הקטע שמעליו, והם נהיים קטע אחד."],
    ["🗑 מחק את הקטע", "מוחק את הקטע. מיד אחרי המחיקה אפשר ללחוץ \"↶ שחזר\"."]]],
  preview: ["📖 תצוגת הספר", [
    ["🔍 חיפוש בספר", "כותבים מילה ולוחצים Enter. כל המקומות נצבעים בצהוב, והחיצים ▲ ▼ עוברים ממקום למקום."],
    ["שני עמודים / עמוד אחד", "לראות שני דפים זה מול זה כמו בספר מודפס, או דף אחד גדול."],
    ["− 100% +", "מקטין או מגדיל את הדפים על המסך. ההדפסה לא משתנה."],
    ["עמוד", "כותבים מספר עמוד, והתצוגה קופצת אליו."],
    ["לחיצה על טקסט בדף", "פותחת את הטקסט לעריכה בצד, והדף מסמן בכחול איפה הסמן עומד."],
    ["לחיצה ימנית על טקסט בדף", "פותחת תפריט: כותרת כאן, מכאן עמוד חדש, לצמצם או להרחיב פסקה, סגנון לפסקה ועוד."],
    ["לחיצה על עיטור בדף", "פותחת את העורך שלו: גודל, מיקום, צבע, להזיז, למחוק — או «כך בכל העיטורים בספר»."],
    ["הפס שבאמצע", "גוררים אותו כדי להגדיל את הספר או את חלון העריכה. ⛶ מסתיר את העריכה, ⇄ מעביר אותה לצד השני."]]],
  menu: ["☰ אפשרויות נוספות (למעלה)", [
    ["📄 הפק PDF להדפסה", "יוצר קובץ של כל הספר, מוכן להדפסה או לבית הדפוס."],
    ["💬 דיווח על תקלה או רעיון", "כותבים, או לוחצים 🎤 ומספרים בקול, מה לא עובד או מה לשפר. אפשר ללחוץ 🖍 ולסמן באדום על המסך את המקומות שלא בסדר. ההודעה מגיעה לאלי מיד, עם צילום של המסך."],
    ["↶ בטל / ↷ החזר", "מבטל את הפעולה האחרונה, או מחזיר את מה שבוטל."],
    ["💡 הצג הסברים", "מציג או מסתיר את ההסברים האלה."],
    ["🕘 גרסאות קודמות", "התוכנה שומרת עותק כל עשר דקות. אפשר להחזיר עיצוב קודם — בלי לגעת בטקסט."],
    ["📚 הספרים שלי", "לפתוח ספר אחר או להתחיל ספר חדש."],
    ["✕", "חזרה לתוכנה הראשית. הכל נשמר לבד."]]],
  design: ["🎨 לשונית עיצוב", [
    ["סגנון מוכן", "לוחצים על אחד הריבועים, והספר כולו מקבל את הצורה הזאת. הטקסט לא משתנה — רק העיצוב."],
    ["גודל הספר", "גודל הדף המודפס."],
    ["אותיות הטקסט", "הגופן, גודל האות והמרווח בין השורות."],
    ["העמוד", "שוליים, טורים, ואיך פסקה מתחילה."],
    ["כותרות", "איך נראות כותרות הפרקים והסימנים. להסתיר אותן — בלשונית \"סגנונות\"."],
    ["הערות", "איך נראות ההערות שבתחתית העמוד."],
    ["🎨 שער הספר", "דף אחד לכל השער. שלב 1: בוחרים שער מהדוגמאות הגדולות. שלב 2 (אם רוצים): \"לשנות את הכתוב\" — שם הספר, המחבר, גופן וגודל כל שורה, וקישוטים (כמאתיים לבחירה). ולמתקדמים: \"עיצוב חופשי\" — גוררים כל דבר לכל מקום. אפשר גם ללחוץ על השער עצמו בתצוגת הספר."],
    ["🖌 סטודיו", "עיצוב חופשי של השער, כמו בתוכנת גרפיקה: גוררים כל דבר לכל מקום, מגדילים ומסובבים, מוסיפים תמונות, מלבנים, עיגולים, קווים, קישוטים ותיבות טקסט, בוחרים צבעים ואטימות. גם: טקסט מעוגל בקשת, צל, קו מתאר, מתיחת אותיות, מעבר צבע, כוכב/סרט/מגן/מדליון, תמונה בעיגול או בקשת, שער עמודים כמו בספרים הישנים. ↶ מבטל."]]],
  styles: ["🖋 לשונית סגנונות", [
    ["איך משתמשים", "1. לוחצים על חלק של הספר (למשל \"כותרת סימן\"). 2. משנים גופן, גודל, או מסתירים אותו. השינוי חל על כל הספר בבת אחת, גם על דפים שיתווספו אחר כך."],
    ["קיצור דרך", "לוחצים על משהו בדף הספר ובוחרים \"שנה בכל הספר\" — ומגיעים ישר לכאן."],
    ["↺ החזר לברירת המחדל", "מבטל את השינויים שעשיתם בחלק הזה."]]],
  details: ["📘 לשונית פרטים", [
    ["מה כותבים כאן", "שם הספר, המחבר, המקום והשנה. זה נדפס בשער הספר ובשורה שבראש העמודים."],
    ["איך משנים את מראה השער", "לוחצים על השער בתצוגת הספר, או בלשונית \"עיצוב\" על \"🎨 שער הספר\": בוחרים עיצוב מוכן, ומשנים כל שורה — גופן, גודל, הדגשה, ריווח, אותיות חלולות, ומקום בדף. אפשר להוסיף שורות וקישוטים, ולבחור מסגרת."]]],
};
const ELEMENT_HELP = {
  body: "הטקסט הרגיל של הספר: גופן, גודל, מרווח בין שורות, ואיך מתחלקות הפסקאות.",
  dibur: "המילים הראשונות של פסקה, עד הסימן שבוחרים (מקף, נקודה, חצי סוגר מרובע ] ועוד — אפשר כמה), שיוצאות מודגשות. בספר על התורה אפשר לקבוע שהדיבור המתחיל הוא ציטוט מפסוק. לבטל: \"בלי\".",
  quoteIn: "ציטוט שנשאר בתוך הקטע (לא קטע נפרד): מהמילה שמתחילה אותו (וז\"ל, כתב…) עד עכ\"ל או סוף המשפט, או בין מירכאות. מסמנים ביד בכפתור \"❝ ציטוט בתוך הקטע\" בעורך, או בהגדרה לכל הספר (📑 בלשונית עיצוב).",
  pasuk: "מילים מן המקרא שמצוטטות בתוך הטקסט. מסמנים ביד בכפתור \"📜 ציטוט מפסוק\" בעורך, או שכל מה שבתוך מירכאות ״…״ נחשב ציטוט מפסוק — הגדרה לכל הספר.",
  num: "מספר בתחילת פסקה, כמו \"א.\" או \"כח)\". לבטל: להוריד את הסימון \"זהה מספר\".",
  opener: "המילה הראשונה אחרי כותרת — גדולה או מודגשת. לבטל: \"בלי\".",
  end: "מה מודפס בסוף כל קטע ובין סימן לסימן. לבטל: \"בלי\".",
  h1: "הכותרת של כל פרק. אפשר להסתיר את כל כותרות הפרקים בבת אחת.",
  h2: "הכותרת של כל סימן. אפשר להסתיר את כל כותרות הסימנים, או רק את המספור.",
  h3: "כותרת קטנה בתוך קטע. אפשר להדפיס אותה כפסקה רגילה, או להסתיר.",
  quote: "שורה שמתחילה ב־> יוצאת מוזחת. אפשר לבטל, והיא תודפס כפסקה רגילה.",
  src: "טקסט בסוגריים עגולים ( ) — מראי מקומות.",
  notes: "ההערות שבתחתית העמוד.",
  head: "השורה הקטנה בראש כל עמוד (שם הספר / הפרק). לבטל: \"בלי\".",
  pnum: "מספרי העמודים. לבטל: \"בלי\".",
  side: "כותרות קטנות בצד הדף, ליד הפסקה. אפשר להסתיר.",
  cols: "טור אחד או שני טורים בעמוד.",
};
function helpBox(k){
  const H = HELP[k];
  if(!H) return "";
  return `<div class="bk-help"><b class="bk-helpt">${H[0]}</b><ul class="bk-helplist">`
    + H[1].map(([a, b]) => `<li><b>${a}</b> — ${b}</li>`).join("") + "</ul></div>";
}
// Abba writes -- or says -- in his own words what is wrong or what to improve. It goes
// through the app's own /api/feedback, which adds the version, the logs and a screenshot
// and sends it to Eli at once (feedback/<machine>/ on the gate). A recording travels in
// the same bundle (voice.webm) and is turned into text on Eli's side
// (tools/pull_abba_feedback.py).
const VOICE_MAX_SEC = 300;
function reportDialog(){
  let kind = "תקלה";
  const D = modal(`<header><h3>💬 דיווח על תקלה או רעיון</h3></header>
  <div class="bk-dbody">
    <div>כתבו או ספרו בקול, במילים פשוטות, מה לא עובד או מה כדאי לשפר. ההודעה נשלחת לאלי מיד, יחד עם צילום של המסך.</div>
    <div class="bk-pills" id="bkRepKind">
      <button type="button" class="bk-pill on" data-k="תקלה">⚠ משהו לא עובד</button>
      <button type="button" class="bk-pill" data-k="רעיון">💡 רעיון לשיפור</button>
    </div>
    <div class="bk-voice">
      <button type="button" class="bk-btn bk-rec" id="bkRepRec">🎤 הקלט בקול</button>
      <span class="bk-rec-state" id="bkRepRecState">אפשר לספר בקול במקום לכתוב (עד 5 דקות)</span>
    </div>
    <div class="bk-voice">
      <button type="button" class="bk-btn bk-rec" id="bkRepMark">🖍 סמן על המסך מה לא תקין</button>
      <span class="bk-rec-state" id="bkRepMarkState">לוחצים על המקומות שלא בסדר — בספר או בכפתורים — והם מסומנים באדום</span>
    </div>
    <div class="bk-clip" id="bkRepClip" hidden><audio controls preload="metadata" id="bkRepAudio"></audio>
      <button type="button" class="bk-btn bk-small" id="bkRepDel">🗑 מחק את ההקלטה</button></div>
    <textarea class="bk-input" id="bkRepText" rows="6" dir="rtl" placeholder="למשל: כשאני לוחץ על &quot;הערה&quot; ההערה לא מופיעה בדף…"></textarea>
    <div id="bkRepInfo" class="bk-hint bk-keep"></div>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkRepSend">📨 שלח לאלי</button>
  <button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
  D.querySelectorAll("#bkRepKind [data-k]").forEach(b => b.addEventListener("click", () => {
    kind = b.dataset.k;
    D.querySelectorAll("#bkRepKind [data-k]").forEach(x => x.classList.toggle("on", x === b));
  }));
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  const ta = D.querySelector("#bkRepText"), info = D.querySelector("#bkRepInfo");
  const recBtn = D.querySelector("#bkRepRec"), recState = D.querySelector("#bkRepRecState");
  const clip = D.querySelector("#bkRepClip"), audio = D.querySelector("#bkRepAudio");
  setTimeout(() => ta.focus(), 50);

  // --- the recording
  const V = {rec:null, stream:null, chunks:[], blob:null, type:"", sec:0, t0:0, timer:null, url:"", closed:false};
  const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  const release = () => {
    clearInterval(V.timer); V.timer = null;
    if(V.stream){ try{ V.stream.getTracks().forEach(t => t.stop()); }catch(e){} V.stream = null; }
  };
  onModalClose = () => {
    V.closed = true;
    markDone(false);
    if(!MK.keep) clearMarks();
    if(V.rec && V.rec.state !== "inactive"){ try{ V.rec.stop(); }catch(e){} }
    release();
    if(V.url){ try{ URL.revokeObjectURL(V.url); }catch(e){} V.url = ""; }
  };
  const idle = (msg) => {
    recBtn.textContent = V.blob ? "🎤 הקלט מחדש" : "🎤 הקלט בקול";
    recBtn.classList.remove("on"); recBtn.disabled = false;
    recState.classList.remove("live");
    recState.textContent = msg;
  };
  const micFailed = (e) => {
    const n = (e && e.name) || "";
    if(n === "NotFoundError" || n === "OverconstrainedError") idle("לא נמצא מיקרופון מחובר למחשב. אפשר לכתוב במקום.");
    else if(n === "NotAllowedError" || n === "SecurityError")
      idle("המיקרופון חסום על ידי Windows: הגדרות ← פרטיות ואבטחה ← מיקרופון, ולהדליק את \"גישת מיקרופון\" ואת \"אפשר ליישומי שולחן עבודה לגשת למיקרופון\". בינתיים אפשר לכתוב.");
    else idle("לא הצלחתי להפעיל את המיקרופון" + (n ? " (" + n + ")" : "") + ". אפשר לכתוב במקום.");
  };
  const startRec = async () => {
    if(!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || !window.MediaRecorder){ micFailed({name:"NotFoundError"}); return; }
    recBtn.disabled = true; recState.textContent = "פותח את המיקרופון…";
    const c = {echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1};
    let stream = null;
    try{
      // the same microphone the chat uses, when one was chosen there
      let want = null;
      try{
        if(typeof audioPref !== "undefined" && audioPref && audioPref.mic && typeof audioLocalIdByLabel === "function")
          want = await audioLocalIdByLabel(audioPref.mic, "audioinput");
      }catch(e){ want = null; }
      try{ stream = await navigator.mediaDevices.getUserMedia({audio: want ? Object.assign({}, c, {deviceId:{exact:want}}) : c}); }
      catch(e){ if(!want) throw e; stream = await navigator.mediaDevices.getUserMedia({audio:c}); }
    }catch(e){ micFailed(e); return; }
    if(V.closed){ try{ stream.getTracks().forEach(t => t.stop()); }catch(e){} return; }
    let mime = "";
    try{ mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(m => MediaRecorder.isTypeSupported(m)) || ""; }catch(e){ mime = ""; }
    let rec;
    try{ rec = new MediaRecorder(stream, mime ? {mimeType:mime, audioBitsPerSecond:32000} : {}); }
    catch(e){ rec = new MediaRecorder(stream); }
    V.rec = rec; V.stream = stream; V.chunks = [];
    rec.ondataavailable = (ev) => { if(ev.data && ev.data.size) V.chunks.push(ev.data); };
    rec.onstop = () => {
      release();
      V.rec = null;
      if(V.closed) return;
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(V.chunks, {type});
      V.chunks = [];
      info.textContent = "";
      if(!blob.size){ idle("ההקלטה יצאה ריקה. נסו שוב, או כתבו במקום."); return; }
      V.blob = blob; V.type = type; V.sec = Math.max(1, Math.round((Date.now() - V.t0) / 1000));
      if(V.url) URL.revokeObjectURL(V.url);
      V.url = URL.createObjectURL(blob);
      audio.src = V.url; clip.hidden = false;
      idle("✓ הוקלטו " + fmt(V.sec) + ". אפשר לשמוע לפני השליחה, ואפשר גם להוסיף מילים בכתב.");
    };
    V.t0 = Date.now();
    rec.start(1000);
    clip.hidden = true;
    recBtn.disabled = false; recBtn.textContent = "⏹ סיים הקלטה"; recBtn.classList.add("on");
    recState.classList.add("live");
    const tickRec = () => {
      const s = (Date.now() - V.t0) / 1000;
      recState.textContent = "● מקליט " + fmt(s) + " — מדברים בחופשיות, ובסוף לוחצים \"סיים הקלטה\"";
      if(s >= VOICE_MAX_SEC && V.rec && V.rec.state === "recording") V.rec.stop();
    };
    tickRec();
    V.timer = setInterval(tickRec, 250);
  };
  recBtn.addEventListener("click", () => {
    if(V.rec && V.rec.state === "recording"){ V.rec.stop(); return; }
    info.textContent = "";
    startRec();
  });
  D.querySelector("#bkRepDel").addEventListener("click", () => {
    V.blob = null; V.sec = 0;
    if(V.url){ URL.revokeObjectURL(V.url); V.url = ""; }
    audio.removeAttribute("src"); clip.hidden = true;
    idle("ההקלטה נמחקה. אפשר להקליט שוב או לכתוב.");
  });
  // --- marking on the screen: the dialog steps aside, every click marks (or unmarks) one place
  const MK = {list:[], bar:null, keep:false};
  const markBtn = D.querySelector("#bkRepMark"), markState = D.querySelector("#bkRepMarkState");
  const clearMarks = () => { document.querySelectorAll(".bk-flagged").forEach(x => x.classList.remove("bk-flagged")); MK.list = []; };
  const markWhere = (el) => {
    const pg = el.closest(".bk-page");
    if(pg){
      const sl = el.closest(".bk-slot[data-idx]"), P = sl ? lastPages[Number(sl.dataset.idx)] : null;
      return P ? "עמוד " + P.n : "בעמוד";
    }
    const tab = ROOT.querySelector(".bk-tab.on,[role=tab][aria-selected=true]");
    return "במסך" + (tab ? " (" + tab.textContent.trim() + ")" : "");
  };
  const markText = (el) => (el.value || el.textContent || el.getAttribute("placeholder") || el.title || "").replace(/\s+/g, " ").trim().slice(0, 90);
  const onMarkClick = (ev) => {
    if(!MK.bar || MK.bar.contains(ev.target) || !ROOT.contains(ev.target)) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    const t = ev.target;
    const el = t.closest(".bk-page") ? (t.closest("p,.bk-note,.bk-h1,.bk-h2,.bk-h3,.bk-hdaf,.bk-head,.bk-foot,div") || t)
                                     : (t.closest("button,label,textarea,input,select,li") || t);
    const i = MK.list.findIndex(m => m.el === el);
    if(i >= 0){ el.classList.remove("bk-flagged"); MK.list.splice(i, 1); }
    else { el.classList.add("bk-flagged"); MK.list.push({el, where: markWhere(el), text: markText(el), cls: el.className && String(el.className).replace("bk-flagged", "").trim()}); }
    MK.bar.querySelector("b").textContent = MK.list.length ? "סומנו " + MK.list.length + " מקומות" : "עוד לא סומן כלום";
    trail("mark", {n: MK.list.length});
  };
  const markDone = (back) => {
    if(!MK.bar) return;
    document.removeEventListener("click", onMarkClick, true);
    MK.bar.remove(); MK.bar = null;
    ROOT.classList.remove("bk-marking");
    if(back){
      $("bkModal").hidden = false;
      markBtn.textContent = MK.list.length ? "🖍 סמן עוד / בטל סימון" : "🖍 סמן על המסך מה לא תקין";
      markState.textContent = MK.list.length ? "✓ סומנו " + MK.list.length + " מקומות באדום. הם יישלחו לאלי יחד עם ההודעה." : "לא סומן כלום. אפשר לסמן שוב, או רק לכתוב.";
      ta.focus();
    }
  };
  markBtn.addEventListener("click", () => {
    if(V.rec){ markState.textContent = "קודם לוחצים \"⏹ סיים הקלטה\", ואז מסמנים."; return; }
    $("bkModal").hidden = true;
    ROOT.classList.add("bk-marking");
    MK.bar = h("div", {class:"bk-markbar"});
    MK.bar.innerHTML = `<span>🖍 לוחצים על כל מקום שלא בסדר — הוא נצבע באדום. לחיצה נוספת מבטלת.</span>
      <b>${MK.list.length ? "סומנו " + MK.list.length + " מקומות" : "עוד לא סומן כלום"}</b>
      <button type="button" class="bk-btn bk-primary">✓ סיימתי לסמן</button>`;
    MK.bar.querySelector("button").addEventListener("click", () => markDone(true));
    ROOT.appendChild(MK.bar);
    document.addEventListener("click", onMarkClick, true);
  });
  const blobB64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(r.error || new Error("read"));
    r.readAsDataURL(blob);
  });

  D.querySelector("#bkRepSend").addEventListener("click", async () => {
    const text = ta.value.trim();
    if(V.rec){ info.textContent = "קודם לוחצים \"⏹ סיים הקלטה\", ואז שולחים."; return; }
    if(!text && !V.blob && !MK.list.length){ info.textContent = "כתבו כמה מילים על מה שקרה, או לחצו על 🎤 וספרו בקול"; ta.focus(); return; }
    const btn = D.querySelector("#bkRepSend");
    btn.disabled = true; recBtn.disabled = true; info.textContent = "שולח…";
    const where = "[עימוד ספר" + (book && book.title ? " · " + book.title : "") + " · לשונית " + ({content:"תוכן", design:"עיצוב", styles:"סגנונות", details:"פרטים"}[currentTab] || currentTab) + "] ";
    try{
      const marks = MK.list.length ? "\n🖍 סימן " + MK.list.length + " מקומות באדום:\n"
        + MK.list.map((m, i) => (i + 1) + ". " + m.where + ": «" + m.text + "»" + (m.cls ? " (" + m.cls + ")" : "")).join("\n") : "";
      const body = {kind: kind === "תקלה" ? "תקלה בעימוד ספר" : "רעיון לעימוד ספר",
                    text: where + (text || (V.blob ? "🎤 הודעה קולית" : "🖍 סימן על המסך")) + marks, run: ""};
      if(V.blob){ body.audio = await blobB64(V.blob); body.audio_type = V.type; body.audio_sec = V.sec; }
      if(MK.list.length){
        // the screenshot is taken right after this: show the marks, not the dialog
        $("bkModal").hidden = true;
        try{ MK.list[0].el.scrollIntoView({block:"center"}); }catch(e){}
        await new Promise(r => setTimeout(r, 400));
        MK.keep = true;
        setTimeout(() => document.querySelectorAll(".bk-flagged").forEach(x => x.classList.remove("bk-flagged")), 6000);
      }
      await postJSON("/api/feedback", body);
      closeModal();
      toast(V.blob ? "✓ ההקלטה נשלחה לאלי. תודה!" : "✓ נשלח לאלי. תודה!", "ok");
    }catch(e){
      $("bkModal").hidden = false; MK.keep = false;
      btn.disabled = false; recBtn.disabled = false;
      info.textContent = "לא הצלחתי לשלוח (" + (e.message || e) + "). נסו שוב בעוד דקה.";
    }
  });
}
function guideDialog(){
  const D = modal(`<header><h3>❓ מדריך — מה עושה כל כפתור</h3></header>
  <div class="bk-dbody bk-guide">${["menu", "list", "section", "preview", "design", "styles", "details"].map(helpBox).join("")}</div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkCancel">סגור</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
}

/* ------------------------------------- the "☰ אפשרויות נוספות" menu */
// Eli asked for the row of top buttons to live under one "כלים" button: the
// top bar stays one slim line and the book gets the room.
function menuOpen(){ const L = $("bkMenuList"); return !!L && !L.hidden; }
function hideMenu(){
  const L = $("bkMenuList");
  if(!L || L.hidden) return;
  L.hidden = true;
  $("bkMenuBtn").setAttribute("aria-expanded", "false");
}
function initMenu(){
  const B = $("bkMenuBtn"), L = $("bkMenuList");
  B.addEventListener("click", e => {
    e.stopPropagation();
    if(!L.hidden){ hideMenu(); return; }
    syncHist();
    L.hidden = false;
    B.setAttribute("aria-expanded", "true");
    const first = L.querySelector("button:not(:disabled)");
    if(first) first.focus({preventScroll:true});
  });
  // any choice closes the menu (the item's own handler runs too)
  L.addEventListener("click", e => { if(e.target.closest("button")) hideMenu(); });
  L.addEventListener("keydown", e => {
    if(e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...L.querySelectorAll("button:not(:disabled)")];
    const i = items.indexOf(document.activeElement);
    const n = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    if(n) n.focus();
  });
  ROOT.addEventListener("pointerdown", e => { if(menuOpen() && !e.target.closest("#bkMenu")) hideMenu(); }, true);
}

/* ------------------------------------------- screen layout (what goes where) */
// Remembered per computer: how wide the editing panel is, which side it sits on,
// whether it is hidden (book on the whole screen) and whether the help notes show.
const SIDE_DEFAULT = 0.28, SIDE_MIN = 0.16, SIDE_MAX = 0.72;
function sideRatio(){
  const r = parseFloat(lsGet("bk_side_w", ""));
  return r >= SIDE_MIN && r <= SIDE_MAX ? r : SIDE_DEFAULT;
}

/* ---------------------------------------------------------- צבעי המסך (looks) */
// Eli (11-01): "תאפשר לאבא לבחור באילו צבעים יהיה המערכת". Five ready looks for the screen
// itself; the printed pages never change. One click, remembered on this computer.
const LOOKS = [
  ["default", "כמו היום", "כחול־אפור רגוע", {bar:"#0f1b30", bg:"#e9edf3", panel:"#fbfcfe", fg:"#14213a"}],
  ["contrast", "ניגודיות גבוהה", "שחור על לבן, קווים עבים", {bar:"#000000", bg:"#ffffff", panel:"#ffffff", fg:"#000000"}],
  ["cream", "קרם חם", "נעים לעיניים עייפות", {bar:"#3b2a12", bg:"#f3ead6", panel:"#fdf8ec", fg:"#2b2113"}],
  ["dark", "כהה", "לעבודה בערב", {bar:"#0a0f18", bg:"#141a26", panel:"#1d2535", fg:"#eef2f8"}],
  ["green", "ירוק רגוע", "כמו שולחן בית מדרש", {bar:"#123b2a", bg:"#e8f1ea", panel:"#f7fbf8", fg:"#10221a"}],
];
function applyLook(k){
  const ok = LOOKS.some(l => l[0] === k) ? k : "default";
  if(ROOT){ if(ok === "default") ROOT.removeAttribute("data-look"); else ROOT.dataset.look = ok; }
  return ok;
}
function looksDialog(){
  const cur = lsGet("bk_look", "default");
  const card = ([k, name, sub, c]) => `<button type="button" class="bk-look${cur === k ? " on" : ""}" data-look-pick="${k}" aria-pressed="${cur === k}">
    <span class="sw" style="background:${c.bg}"><i style="background:${c.bar}"></i><b style="background:${c.panel};color:${c.fg}">ברוך ה' שהחיינו וקיימנו</b></span>
    <span class="nm">${name}<small>${sub}</small></span></button>`;
  const D = modal(`<header><h3>🎨 צבעי המסך</h3></header><div class="bk-dbody">
    <div>איך ייראו הכפתורים, הפסים והחלונות של התוכנה. <b>דפי הספר עצמם נשארים כמו שהם מודפסים.</b> לוחצים על צבע — והוא נשמר.</div>
    <div class="bk-looks">${LOOKS.map(card).join("")}</div>
  </div><footer><button class="bk-btn bk-primary" type="button" id="bkCancel">סיום</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelectorAll("[data-look-pick]").forEach(b => b.addEventListener("click", () => {
    const k = applyLook(b.dataset.lookPick); lsSet("bk_look", k);
    D.querySelectorAll("[data-look-pick]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    const L = LOOKS.find(l => l[0] === k);
    toast("✓ צבעי המסך: " + L[1] + " — דפי הספר לא השתנו", "ok");
  }));
}
function applyLayoutPrefs(){
  applyLook(lsGet("bk_look", "default"));
  const M = $("bkMain");
  M.style.setProperty("--bk-side", (sideRatio() * 100).toFixed(1) + "%");
  M.classList.toggle("bk-swap", lsGet("bk_swap", "0") === "1");
  const noside = lsGet("bk_noside", "0") === "1";
  M.classList.toggle("bk-noside", noside);
  $("bkSideBtn").innerHTML = noside ? "<span>📝</span><span class=\"bk-v\">הצג עריכה</span>" : "<span>⛶</span><span class=\"bk-v\">הסתר עריכה</span>";
  $("bkSideBtn").title = noside ? "להחזיר את חלון העריכה" : "להסתיר את חלון העריכה ולראות את הספר על כל המסך";
  $("bkSideBtn").classList.toggle("on", noside);
  $("bkSwapBtn").hidden = noside;
  $("bkSplit").title = noside ? "" : "גררו כדי להגדיל או להקטין · לחיצה כפולה מחזירה לגודל הרגיל";
  ROOT.classList.toggle("bk-simple", lsGet("bk_simple", "1") === "1");
  $("bkSimpleBtn").textContent = ROOT.classList.contains("bk-simple") ? "🧩 להציג את כל הכפתורים" : "🧩 מצב פשוט (פחות כפתורים)";
  $("bkSimpleBtn").setAttribute("aria-pressed", String(ROOT.classList.contains("bk-simple")));
  const help = lsGet("bk_help", "0") === "1";
  ROOT.classList.toggle("bk-help-on", help);
  $("bkHelpBtn").textContent = help ? "💡 הסתר הסברים" : "💡 הצג הסברים";
  $("bkHelpBtn").setAttribute("aria-pressed", String(help));
  $("bkSplit").setAttribute("aria-valuenow", String(Math.round(sideRatio() * 100)));
}
function initSplitter(){
  const S = $("bkSplit"), M = $("bkMain");
  let drag = false, tm = null;
  // the panel can sit on either side, so measure where it really is
  const ratioAt = (x) => {
    const r = M.getBoundingClientRect(), side = $("bkSide").getBoundingClientRect();
    const onRight = side.left + side.width / 2 > r.left + r.width / 2;
    return (onRight ? r.right - x : x - r.left) / Math.max(1, r.width);
  };
  const setRatio = (v) => {
    lsSet("bk_side_w", String(Math.max(SIDE_MIN, Math.min(SIDE_MAX, v)).toFixed(3)));
    applyLayoutPrefs();
  };
  const refresh = (now) => { clearTimeout(tm); tm = null; if(now) showPages(); else tm = setTimeout(showPages, 160); };
  // nothing to drag while the panel is hidden, or on a narrow screen where it sits on top
  const canDrag = () => !M.classList.contains("bk-noside") && !getComputedStyle(M).flexDirection.startsWith("column");
  S.addEventListener("pointerdown", e => {
    if(e.button !== 0 || e.target.closest("button") || !canDrag()) return;
    e.preventDefault();
    drag = true;
    try{ S.setPointerCapture(e.pointerId); }catch(err){}
    ROOT.classList.add("bk-dragging");
  });
  S.addEventListener("pointermove", e => {
    if(!drag) return;
    setRatio(ratioAt(e.clientX));
    if(!tm) refresh(false);
  });
  const end = () => {
    if(!drag) return;
    drag = false;
    ROOT.classList.remove("bk-dragging");
    refresh(true);
  };
  S.addEventListener("pointerup", end);
  S.addEventListener("pointercancel", end);
  S.addEventListener("dblclick", e => { if(e.target.closest("button") || !canDrag()) return; lsSet("bk_side_w", ""); applyLayoutPrefs(); refresh(true); });
  S.addEventListener("keydown", e => {
    if(e.target !== S || !canDrag() || (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home")) return;
    e.preventDefault();
    if(e.key === "Home"){ lsSet("bk_side_w", ""); applyLayoutPrefs(); refresh(true); return; }
    const r = S.getBoundingClientRect();
    setRatio(ratioAt(r.left + r.width / 2 + (e.key === "ArrowLeft" ? -30 : 30)));
    refresh(false);
  });
}

/* --------------------------------------------- search a word in the book */
// Looks in the pages exactly as they are shown (and printed): the running head,
// page number and catchword repeat on every page, so they are left out.
const SR = {q:"", hits:[], parts:[], marks:[], idx:-1, timer:null};
const SEARCH_CAP = 3000;
function clearSearchMarks(){
  for(const m of SR.marks){
    const p = m.parentNode;
    if(!p) continue;
    p.replaceChild(document.createTextNode(m.textContent), m);
    p.normalize();
  }
  SR.hits = []; SR.parts = []; SR.marks = [];
}
// A page's text is read as ONE string, so a match may run across styles: "(שבת לא.)"
// is printed in the small mareh-makom style, a bold dibur sits inside a sentence, etc.
// Every piece of the match gets its own <mark>; SR.hits keeps the first piece of each.
function markSearch(q){
  clearSearchMarks();
  SR.q = q;
  if(!q) return;
  const re = findRegex(q, false, true);
  const skip = ".bk-head,.bk-foot,.bk-catch,.bk-mk";
  for(const P of lastPages){
    const w = document.createTreeWalker(P.el, NodeFilter.SHOW_TEXT,
      {acceptNode: n => n.nodeValue && n.parentElement && !n.parentElement.closest(skip) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT});
    const nodes = [];
    let n, full = "";
    while((n = w.nextNode())){ nodes.push({n, at: full.length}); full += n.nodeValue; }
    if(!nodes.length) continue;
    const segs = new Map();          // node index -> [[from, to, hit]]
    re.lastIndex = 0;
    let m;
    while((m = re.exec(full))){
      if(!m[0].length){ re.lastIndex++; continue; }
      const a = m.index, b = a + m[0].length, hit = SR.parts.length;
      SR.parts.push([]);
      for(let i = 0; i < nodes.length; i++){
        const na = nodes[i].at, nb = na + nodes[i].n.nodeValue.length;
        if(nb <= a) continue;
        if(na >= b) break;
        if(!segs.has(i)) segs.set(i, []);
        segs.get(i).push([Math.max(a, na) - na, Math.min(b, nb) - na, hit]);
      }
      if(SR.parts.length >= SEARCH_CAP) break;
    }
    for(const [i, list] of segs){
      const tn = nodes[i].n, txt = tn.nodeValue, frag = document.createDocumentFragment();
      let last = 0;
      for(const [from, to, hit] of list){
        if(from > last) frag.appendChild(document.createTextNode(txt.slice(last, from)));
        const mk = document.createElement("mark");
        mk.className = "bk-hit";
        mk.dataset.pg = P.idx;
        mk.textContent = txt.slice(from, to);
        frag.appendChild(mk);
        SR.parts[hit].push(mk);
        SR.marks.push(mk);
        last = to;
      }
      if(last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    }
    if(SR.parts.length >= SEARCH_CAP) break;
  }
  // pieces are made page by page in reading order, so the first piece of a hit leads
  SR.hits = SR.parts.map(list => list[0]).filter(Boolean);
}
function syncSearchBar(){
  const out = $("bkSearchN");
  if(!out) return;
  const n = SR.hits.length;
  out.textContent = !SR.q ? "" : (!n ? "לא נמצא" : (SR.idx + 1) + " מתוך " + (n >= SEARCH_CAP ? SEARCH_CAP + "+" : n));
  out.classList.toggle("none", !!SR.q && !n);
  // the count sits inside the box: keep the typed word clear of it
  $("bkSearchQ").style.paddingLeft = out.textContent ? (out.offsetWidth + 16) + "px" : "";
  $("bkSearchPrev").disabled = n < 2;
  $("bkSearchNext").disabled = n < 2;
}
function showHit(i){
  const n = SR.hits.length;
  if(!n){ SR.idx = -1; syncSearchBar(); return; }
  (SR.parts[SR.idx] || []).forEach(x => x.classList.remove("cur"));
  SR.idx = ((i % n) + n) % n;
  const mk = SR.hits[SR.idx];
  (SR.parts[SR.idx] || [mk]).forEach(x => x.classList.add("cur"));
  syncSearchBar();
  const V = $("bkViewer");
  if(V && V.contains(mk)){
    const vr = V.getBoundingClientRect(), mr = mk.getBoundingClientRect();
    V.style.scrollBehavior = "auto";
    V.scrollTop += (mr.top - vr.top) - V.clientHeight / 3;
    V.style.scrollBehavior = "";
  }
}
function runSearch(){
  clearTimeout(SR.timer);
  const q = ($("bkSearchQ").value || "").trim();
  if(q === SR.q && SR.hits.length && SR.hits[0].isConnected){ showHit(SR.idx + 1); return; }
  markSearch(q);
  if(!q){ SR.idx = -1; syncSearchBar(); return; }
  // start from the page that is on the screen now, not from the start of the book
  const top = topVisibleIndex();
  const at = SR.hits.findIndex(m => Number(m.dataset.pg) >= top);
  SR.idx = -1;
  showHit(at < 0 ? 0 : at);
}
function refreshSearchAfterLayout(){
  // new pages were made: mark them again, stay on the same place in the list
  if(!SR.q) return;
  const keep = SR.idx;
  markSearch(SR.q);
  SR.idx = -1;
  if(SR.hits.length){ SR.idx = Math.min(Math.max(keep, 0), SR.hits.length - 1); (SR.parts[SR.idx] || []).forEach(x => x.classList.add("cur")); }
  syncSearchBar();
}
function initSearch(){
  const q = $("bkSearchQ");
  q.addEventListener("keydown", e => {
    if(e.key === "Enter"){
      e.preventDefault();
      if(e.shiftKey && SR.q === q.value.trim() && SR.hits.length) showHit(SR.idx - 1);
      else runSearch();
    }else if(e.key === "Escape" && q.value){
      e.preventDefault(); e.stopPropagation();
      q.value = ""; markSearch(""); SR.idx = -1; syncSearchBar();
    }
  });
  q.addEventListener("input", () => {
    clearTimeout(SR.timer);
    const v = q.value.trim();
    if(!v){ markSearch(""); SR.idx = -1; syncSearchBar(); return; }
    if(v.length < 2) return;           // one letter would light up the whole book; Enter still searches it
    SR.timer = setTimeout(runSearch, 350);
  });
  $("bkSearchNext").addEventListener("click", () => { if(SR.hits.length) showHit(SR.idx + 1); else runSearch(); });
  $("bkSearchPrev").addEventListener("click", () => { if(SR.hits.length) showHit(SR.idx - 1); else runSearch(); });
  syncSearchBar();
}
function focusSearch(){
  const q = $("bkSearchQ");
  if(!q) return;
  q.closest(".bk-pvbar").classList.add("bk-findon");
  q.focus();
  q.select();
}
function onKey(e){
  e.stopPropagation();
  if(e.key === "Escape"){
    if(menuOpen()){ hideMenu(); $("bkMenuBtn").focus(); e.preventDefault(); return; }
    if($("bkPop")){ hidePop(); e.preventDefault(); return; }
    if(!$("bkModal").hidden){ closeModal(); e.preventDefault(); }
    return;
  }
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
  const inDialogField = !$("bkModal").hidden && e.target.closest && e.target.closest("#bkModal") && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
  if((inDialogField || e.target.id === "bkSearchQ") && (e.code === "KeyZ" || e.code === "KeyY")) return;
  if(mod && e.code === "KeyZ"){ e.preventDefault(); if(e.shiftKey) redo(); else undo(); return; }
  if(mod && e.code === "KeyY"){ e.preventDefault(); redo(); return; }
  if(mod && e.code === "KeyF"){ e.preventDefault(); if($("bkModal").hidden) focusSearch(); else findDialog(false); return; }
  if(mod && e.code === "KeyH"){ e.preventDefault(); findDialog(true); return; }
  if(mod && e.code === "KeyB" && e.target.classList && e.target.classList.contains("bk-textarea")){ e.preventDefault(); wrapSel(e.target, "*", "*"); return; }
  if((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S" || e.key === "ד")){ e.preventDefault(); dirty = true; saveNow(); toast("הספר נשמר", "ok"); return; }
  if((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P" || e.key === "פ")){ e.preventDefault(); exportPdf(); }
}
function syncViewBar(){
  ROOT.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === viewMode));
  $("bkZoomLbl").textContent = Math.round(userZoom * 100) + "%";
}
function setZoom(z){
  userZoom = Math.max(0.4, Math.min(3, z));
  lsSet("bk_zoom", String(userZoom));
  syncViewBar();
  showPages();
}
// A1: the same three sizes as the main program (its א−/א+), from inside the studio too
const TS = ["normal", "big", "huge"], TS_NAME = {normal:"רגיל", big:"גדול", huge:"ענק"};
function tsSync(){
  const cur = document.documentElement.dataset.textsize || "normal";
  const L = $("bkTsLabel"); if(L) L.textContent = TS_NAME[cur] || "רגיל";
  const d = $("bkTsDown"), u = $("bkTsUp");
  if(d) d.disabled = cur === "normal";
  if(u) u.disabled = cur === "huge";
}
function tsStep(dir){
  const cur = document.documentElement.dataset.textsize || "normal";
  const i = Math.max(0, Math.min(TS.length - 1, TS.indexOf(cur) + dir));
  if(typeof APP.textSize === "function") APP.textSize(TS[i]);
  else { document.documentElement.dataset.textsize = TS[i]; try{ localStorage.setItem("mishk_textsize", TS[i]); }catch(e){} }
  applyZoomCompensation(); tsSync();
  toast("גודל הכתב במסך: " + TS_NAME[TS[i]] + " (הספר המודפס לא משתנה)", "ok");
}
function applyZoomCompensation(){
  // The main app zooms <body> for its big-text modes. Pages must be measured
  // and shown at true size (zoom 1) or the PDF would break lines differently.
  let z = 1;
  try{ z = parseFloat(getComputedStyle(document.body).zoom) || 1; }catch(e){}
  const inv = String(1 / z);
  $("bkPreview").style.zoom = inv;
  $("bkMeasure").style.zoom = inv;
}
function setTab(tab, topic){
  if(topic === undefined){ const b = ROOT.querySelector(`.bk-tab[data-tab="${tab}"][id]`); topic = b ? b.dataset.topic : tab; }
  currentTopic = topic; railOpen = true; syncRail();
  currentTab = tab;
  for(const [t, id] of [["content","bkPanelContent"],["design","bkPanelDesign"],["styles","bkPanelStyles"],["details","bkPanelDetails"]]){
    $(id).hidden = t !== tab;
  }
  ROOT.querySelectorAll(".bk-rail .bk-tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.topic === currentTopic)));
  if(tab === "design"){ renderDesign(); railFilterDesign(); }
  if(tab === "details") renderDetails();
  if(tab === "styles") renderStyles();
}
function syncRail(){
  const side = $("bkSide"); if(!side) return;
  side.classList.toggle("bk-railonly", !railOpen); side.classList.toggle("bk-narrow", railNarrow);
  const T = RAIL_TOPICS.find(x => x[0] === currentTopic);
  if($("bkRailTitle")) $("bkRailTitle").textContent = T ? T[2] : "";
  if($("bkRailSub")) $("bkRailSub").textContent = RAIL_SUB[currentTopic] || "";
  const n = $("bkRailNarrow"); if(n){ n.textContent = railNarrow ? "◂▸" : "▸◂"; n.title = n.ariaLabel = railNarrow ? "הרחב את הסרגל" : "צמצם לסמלים"; }
  ROOT.querySelectorAll(".bk-rail .bk-tab").forEach(b => b.setAttribute("aria-selected", String(railOpen && b.dataset.topic === currentTopic)));
}
// show only the design sections of the chosen topic (the folds open flat, their names hidden)
function railFilterDesign(){
  const P = $("bkPanelDesign"); if(!P) return;
  P.classList.toggle("bk-topic", currentTopic !== "all");
  if(currentTopic === "all"){ P.querySelectorAll("*").forEach(n => { if(n.style.display === "none") n.style.display = ""; }); P.querySelectorAll(".bk-fold").forEach(d => d.hidden = false); return; }
  const want = RAIL_SECT[currentTopic] || [];
  for(const n of [...P.children]){ if(!n.classList.contains("bk-fold")) n.style.display = currentTopic === "ready" ? "" : "none"; }
  P.querySelectorAll(".bk-fold").forEach(d => {
    d.open = true; let cur = "", any = false;
    for(const n of [...d.querySelector(".bk-foldbody").children]){
      if(n.matches("h3.bk-h")) cur = n.textContent;
      const show = want.some(w => cur.includes(w)); n.style.display = show ? "" : "none"; if(show) any = true;
    }
    d.hidden = !any;
  });
}
function renderTop(){
  $("bkTopTitle").textContent = book && book.title ? "· " + book.title : "· ספר חדש";
}

/* ----------------------------------------------------------- content tab */
function renderContent(){
  const P = $("bkPanelContent");
  if(!book) return;
  P.innerHTML = `
${helpBox("list")}
<div class="bk-toolrow" role="toolbar" aria-label="הוספה לספר">
  <button class="bk-tool" type="button" data-act="add-chapter"><i>＋</i>${esc(st.chapterWord || "פרק")} חדש</button>
  <button class="bk-tool" type="button" data-act="add-siman"><i>＋</i>${esc(st.simanWord || "סימן")} חדש</button>
  <button class="bk-tool" type="button" data-act="import"><i>⤓</i>ייבוא</button>
  <button class="bk-tool" type="button" data-act="tools"><i>⚙</i>כלים</button>
</div>
<div class="bk-listhead"><b>קטעי הספר</b><span class="bk-cnt" id="bkSecCount"></span></div>
<div class="bk-what-part">כל <b>כותרת</b> פותחת <b>קטע</b>, והוא נמשך עד הכותרת הבאה. להוסיף כותרת: לוחצים על הפסקה בדף ← «➕ כותרת כאן».</div>
<div class="bk-sections" id="bkSections"></div>
<button class="bk-btn bk-soft bk-wide" type="button" data-act="add-end">➕ הוסף קטע בסוף הספר</button>
<div id="bkUndoSlot"></div>`;
  renderSections();
}
function secHead(sec){
  const isOpen = sec.id === openSec;
  // an untitled plain-text part shows its first words as they are (it just continues the
  // text before it, so a "טקסט" badge on every card says nothing)
  const plain = sec.kind === "text" && !sec.title;
  const fw = firstWords(sec.text);
  const title = sec.title || (fw ? fw + "…" : "") || "(עדיין ריק)";
  const cont = !sec.title && fw && book.sections.indexOf(sec) > 0;
  const n = countNotes(sec.text);
  return `<div class="bk-sec-head" role="button" tabindex="0" data-act="toggle" aria-expanded="${isOpen}" title="${isOpen ? "לחצו כדי לסגור את הקטע" : "לחצו כדי לפתוח את הקטע ולערוך את הטקסט שלו"}">
    ${plain ? "" : `<span class="bk-kind k-${sec.kind}" title="${esc(KIND_HINT[sec.kind] || "")}">${esc(kindName(sec.kind))}</span>`}
    <span class="bk-sec-title${sec.title ? "" : (plain && fw ? " txt" : " dim")}">${cont ? "<small class=\"bk-sec-cont\" title=\"בלי כותרת — המשך של הקטע הקודם\">המשך · </small>" : ""}${esc(title)}</span>
    ${dafLabel(sec) ? "<span class=\"bk-sec-daf\" title=\"הדף בגמרא שהקטע עוסק בו\">" + esc(dafLabel(sec)) + "</span>" : ""}
    ${n ? "<span class=\"bk-sec-meta\">" + (n === 1 ? "הערה אחת" : n + " הערות") + "</span>" : ""}
    <span class="bk-caret">${isOpen ? "סגירה" : "עריכה"}</span></div>`;
}
// "דף בגמרא": which daf this part is on. It is printed as a small heading where the
// daf changes and in the running head; a part left empty goes on with the daf before it.
function dafRow(sec){
  const n = parseInt(sec.daf, 10) || 0;
  let opts = "<option value=\"\">—</option>";
  for(let i = 2; i <= 176; i++) opts += `<option value="${i}"${i === n ? " selected" : ""}>${gem(i)}</option>`;
  const am = [["", "—"], ["א", "ע״א ( . )"], ["ב", "ע״ב ( : )"]]
    .map(([v, l]) => `<option value="${v}"${(sec.amud || "") === v ? " selected" : ""}>${l}</option>`).join("");
  let prev = "";
  if(!n) for(const s of book.sections){ if(s === sec) break; const d = dafLabel(s, st.dafFormat); if(d) prev = d; }
  const hint = n ? "במקום שהדף מתחיל ובראש העמוד יודפס: <b>" + esc(dafLabel(sec, st.dafFormat)) + "</b>"
    : (prev ? "לא נבחר דף — הקטע ממשיך את <b>" + esc(prev) + "</b> שלפניו"
      : "בוחרים על איזה דף בגמרא הקטע. הדף יודפס ככותרת משנה ובראש העמוד.");
  return `<div class="bk-row bk-dafrow">
    <label class="bk-field">דף בגמרא<select class="bk-select" data-f="daf">${opts}</select></label>
    <label class="bk-field">עמוד<select class="bk-select" data-f="amud"${n ? "" : " disabled"}>${am}</select></label>
    <label class="bk-field bk-grow">מסכת (אחת לכל הספר)<input class="bk-input" data-f="masechet" value="${esc(book.masechet || "")}" placeholder="למשל: מכות"/></label>
  </div>
  <div class="bk-hint bk-keep bk-dafhint">${hint}</div>`;
}
function secBody(sec){
  const kinds = KINDS.map(([k, l]) => `<option value="${k}"${k === sec.kind ? " selected" : ""}>${l}</option>`).join("");
  const ph = {chapter:"למשל: בגדר המצוה", siman:"למשל: חיוב הלימוד", intro:"הקדמה", haskama:"הסכמת הרב…", part:"למשל: חלק ראשון", text:"לא חובה"}[sec.kind] || "";
  return `<div class="bk-sec-body">${helpBox("section")}
  <div class="bk-row" style="margin-top:10px">
    <label class="bk-field">סוג הקטע<select class="bk-select" data-f="kind">${kinds}</select></label>
    <label class="bk-field bk-grow">כותרת<input class="bk-input" data-f="title" value="${esc(sec.title)}" placeholder="${esc(ph)}"/></label>
    <label class="bk-field" title="כל הפסקאות של הקטע הזה בלבד יודפסו כך. שאר הספר לא משתנה">מראה כל הקטע<select class="bk-select" data-f="look">${SEC_LOOKS.map(([v, l]) => `<option value="${v}"${(sec.look || "") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
  </div>
  ${dafRow(sec)}
  <details class="bk-secmore"${sec.cols || sec.oddPage || sec.head || sec.pnumStart ? " open" : ""}><summary>📐 עמודים וטורים של הקטע הזה</summary>
  <div class="bk-row" style="margin-top:6px">
    <label class="bk-field">טורים בקטע הזה<select class="bk-select" data-f="cols"><option value=""${!sec.cols ? " selected" : ""}>כמו כל הספר</option><option value="1"${sec.cols === 1 ? " selected" : ""}>טור אחד</option><option value="2"${sec.cols === 2 ? " selected" : ""}>שני טורים</option></select></label>
    <label class="bk-check"><input type="checkbox" data-f="oddPage"${sec.oddPage ? " checked" : ""}/><span>מתחיל בעמוד אי-זוגי<small>בצד השמאלי של הספר הפתוח; אם צריך — עמוד ריק לפניו</small></span></label>
  </div>
  <div class="bk-row">
    <label class="bk-field bk-grow">כותרת עליונה לקטע<input class="bk-input" data-f="head" value="${esc(sec.head || "")}" placeholder="כמו בכל הספר (שם הפרק)"/></label>
    <label class="bk-field">מספר העמוד מתחיל מ-<input class="bk-input" type="number" min="0" max="9999" style="width:6em" data-f="pnumStart" value="${sec.pnumStart || ""}" placeholder="המשך"/></label>
  </div></details>
  <div class="bk-fmtbar" role="toolbar" aria-label="כלי כתיבה">
    <button class="bk-btn bk-soft" type="button" data-act="newdaf" title="שמים את הסמן במקום שבו מתחיל דף חדש בגמרא, ולוחצים">📖 כאן מתחיל דף חדש</button>
    <button class="bk-btn bk-soft" type="button" data-act="note" title="הערה שתודפס בתחתית העמוד">＋ הערה <kbd class="bk-kbd">Ctrl+K</kbd></button>
    <button class="bk-btn bk-soft" type="button" data-act="src" title="הערה בסדרה השנייה (מראי מקומות)">＋ מראה מקום</button>
    <button class="bk-btn" type="button" data-act="bold"><b>ב</b>&nbsp;הדגשה <kbd class="bk-kbd">Ctrl+B</kbd></button>
    <button class="bk-btn" type="button" data-act="sub">כותרת משנה <kbd class="bk-kbd">Ctrl+G</kbd></button>
    <button class="bk-btn" type="button" data-act="side">כותרת בשוליים</button>
    <button class="bk-btn" type="button" data-act="center">שורה במרכז <kbd class="bk-kbd">Ctrl+E</kbd></button>
    <button class="bk-btn bk-dictate" type="button" data-act="dictate" hidden title="מדברים, והמילים נכתבות במקום שבו עומד הסמן">🎤 הכתבה</button>
  </div>
  <details class="bk-more bk-adv-only"${lsGet("bk_more", "0") === "1" ? " open" : ""}><summary>🎨 עוד עיצוב למילים ולשורות</summary>
  <div class="bk-fmtbar" role="toolbar" aria-label="עיצוב מילים">
    <button class="bk-btn" type="button" data-act="tag" data-tag="פס" title="המילים המסומנות הן ציטוט מפסוק">📜 ציטוט מפסוק</button>
    <button class="bk-btn" type="button" data-act="tag" data-tag="צט" title="המילים המסומנות הן ציטוט בתוך הקטע">❝ ציטוט בתוך הקטע</button>
    <button class="bk-btn" type="button" data-act="tag" data-tag="ק">אותיות קטנות</button>
    <button class="bk-btn" type="button" data-act="tag" data-tag="ג">אותיות גדולות</button>
    <button class="bk-btn" type="button" data-act="tag" data-tag="רש">אותיות רש"י</button>
    <button class="bk-btn" type="button" data-act="tag" data-tag="מר">אותיות מרובעות</button>
    <button class="bk-btn" type="button" data-act="tag" data-tag="רו">ר ו ו ח</button>
    <button class="bk-btn" type="button" data-act="tag" data-tag="קו"><u>קו תחתון</u></button>
    <button class="bk-btn" type="button" data-act="tag" data-tag="אפ">אפור</button>
    <button class="bk-btn" type="button" data-act="sep">✻ מפריד</button>
    <button class="bk-btn" type="button" data-act="quote">❝ ציטוט מוזח</button>
    <button class="bk-btn" type="button" data-act="pagebreak">⤓ עמוד חדש</button>
    <button class="bk-btn" type="button" data-act="colbreak">⇥ טור חדש</button>
  </div></details>
  <textarea class="bk-textarea" data-f="text" dir="rtl" spellcheck="false" aria-label="הטקסט של הקטע">${esc(sec.text)}</textarea>
  <div class="bk-where" aria-live="polite"></div>
  <div class="bk-hint">הערות נכתבות בתוך { } ועוברות לבד לתחתית העמוד הנכון. מראי מקומות בתוך {{ }}. מילים בין כוכביות *כך* יודגשו.
   כותרת בשוליים: [[ ]] בתחילת הפסקה. פסקה שמתחילה ב"א." מקבלת מספר סעיף מודגש. דיבור המתחיל שנכתב בשורה משלו (עד 4 מילים, בלי נקודה) נכנס מודגש לתחילת הפסקה שאחריו.</div>
  <div class="bk-sec-actions">
    <button class="bk-btn" type="button" data-act="up" title="להזיז את כל הקטע הזה מקום אחד למעלה בספר">▲ הזז את הקטע למעלה</button>
    <button class="bk-btn" type="button" data-act="down" title="להזיז את כל הקטע הזה מקום אחד למטה בספר">▼ הזז את הקטע למטה</button>
    <button class="bk-btn" type="button" data-act="split" title="שמים את הסמן בטקסט ולוחצים: מה שאחרי הסמן עובר לקטע חדש משלו">✂ חתוך כאן לשני קטעים</button>
    <button class="bk-btn" type="button" data-act="add-after" title="מוסיף קטע ריק חדש מיד אחרי הקטע הזה">＋ קטע ריק חדש אחריו</button>
    <button class="bk-btn" type="button" data-act="merge" title="הטקסט של הקטע הזה מצטרף לסוף הקטע שמעליו, והם נהיים קטע אחד">⤴ צרף לקטע שמעליו</button>
    <button class="bk-btn bk-danger" type="button" data-act="del" title="מוחק את כל הקטע הזה. אפשר לשחזר מיד אחרי">🗑 מחק את הקטע</button>
  </div></div>`;
}
function renderSections(){
  const L = $("bkSections");
  if(!L) return;
  L.innerHTML = book.sections.map(sec => `<div class="bk-sec${sec.id === openSec ? " open" : ""}" data-id="${sec.id}">${secHead(sec)}${sec.id === openSec ? secBody(sec) : ""}</div>`).join("");
  const c = $("bkSecCount");
  if(c) c.textContent = book.sections.length;
  showDictate();
}
function refreshHead(sec){
  const card = ROOT.querySelector(".bk-sec[data-id=\"" + sec.id + "\"]");
  if(!card) return;
  const old = card.querySelector(".bk-sec-head");
  const tmp = h("div", null, secHead(sec));
  old.replaceWith(tmp.firstElementChild);
}
function secOf(el){
  const card = el.closest(".bk-sec");
  if(!card) return null;
  return book.sections.find(s => s.id === card.dataset.id) || null;
}
function showDictate(){
  dictateReady().then(ok => { if(ok) ROOT.querySelectorAll(".bk-dictate").forEach(x => { x.hidden = false; }); });
}
function openSection(id, focusText){
  openSec = id;
  renderSections();
  const card = ROOT.querySelector(".bk-sec[data-id=\"" + id + "\"]");
  if(card){
    card.scrollIntoView({block:"nearest"});
    const el = card.querySelector(focusText ? "textarea" : ".bk-input");
    if(el) el.focus();
  }
  if(id) scrollToSection(id);
}
function onContentClick(e){
  const b = e.target.closest("[data-act]");
  if(!b) return;
  const act = b.dataset.act;
  const sec = secOf(b);
  const idx = sec ? book.sections.indexOf(sec) : -1;
  const ta = sec ? ROOT.querySelector(".bk-sec[data-id=\"" + sec.id + "\"] textarea") : null;
  if(act === "dictate"){ dictateToggle(b); return; }
  if(act === "toggle" && openSec === sec.id && !String(sec.text || "").trim() && !String(sec.title || "").trim() && book.sections.length > 1){
    book.sections.splice(book.sections.indexOf(sec), 1); openSec = null; markDirty(); renderSections(); scheduleLayout(0);
    toast("קטע ריק נסגר ונמחק (לא היה בו כלום). אפשר להחזיר עם ↶", "ok"); return;
  }
  if(act === "toggle"){ openSec = (openSec === sec.id) ? null : sec.id; renderSections(); if(openSec){ const t = ROOT.querySelector(".bk-sec.open textarea"); if(t) t.focus({preventScroll:true}); scrollToSection(sec.id); } return; }
  if(act === "add-chapter" || act === "add-siman"){
    // v1.8.97 (Abba 11-03, 8 undos in 15 minutes: "סימן חדש" made an EMPTY part next to the open one, never where he
    // wanted the heading): with a place in the text — the cursor, or the paragraph clicked on the page — the heading
    // goes right there (the text splits); only with no place at all is an empty part added at the end
    const P = ribPara();
    if(P && String(P.sec.text || "").trim()){ headingHere(P.sec, P.ln, act === "add-chapter" ? 1 : 2); return; }
  }
  if(act === "add-chapter" || act === "add-siman" || act === "add-end" || act === "add-after"){
    const kind = act === "add-chapter" ? "chapter" : (act === "add-siman" ? "siman" : (sec ? sec.kind : "chapter"));
    const ns = {id:uid("s"), kind: (act === "add-end" ? (book.sections.length ? book.sections[book.sections.length - 1].kind : "chapter") : kind), title:"", text:""};
    let at = book.sections.length;
    if(act === "add-after") at = idx + 1;
    else if(act !== "add-end" && openSec){ const oi = book.sections.findIndex(s => s.id === openSec); if(oi >= 0) at = oi + 1; }
    book.sections.splice(at, 0, ns);
    markDirty(); openSection(ns.id, false); scheduleLayout(300);
    return;
  }
  if(act === "import"){ showImport(); return; }
  if(act === "tools"){ showTools(); return; }
  if(!sec) return;
  if(act === "up" || act === "down"){
    const j = act === "up" ? idx - 1 : idx + 1;
    if(j < 0 || j >= book.sections.length) return;
    book.sections.splice(idx, 1); book.sections.splice(j, 0, sec);
    markDirty(); renderSections(); scheduleLayout(200);
    const card = ROOT.querySelector(".bk-sec[data-id=\"" + sec.id + "\"] [data-act=\"" + act + "\"]");
    if(card) card.focus();
    return;
  }
  if(act === "del"){
    confirmBox("למחוק את הקטע?", "«" + esc(sec.title || firstWords(sec.text) || KIND_LABEL[sec.kind]) + "» יימחק מהספר. אפשר לשחזר מיד אחרי המחיקה.", "🗑 מחק", () => {
      book.sections.splice(idx, 1);
      if(!book.sections.length) book.sections.push({id:uid("s"), kind:"chapter", title:"", text:""});
      undoSec = {sec, idx};
      openSec = null; markDirty(); renderSections(); scheduleLayout(150); showUndo();
    });
    return;
  }
  if(act === "merge"){
    if(idx <= 0){ toast("זה הקטע הראשון — אין קטע קודם", "warn"); return; }
    const prev = book.sections[idx - 1];
    prev.text = [prev.text.replace(/\s+$/, ""), (sec.title ? "# " + sec.title : ""), sec.text].filter(Boolean).join("\n");
    book.sections.splice(idx, 1);
    openSec = prev.id; markDirty(); renderSections(); scheduleLayout(150);
    toast("הקטעים חוברו — אפשר לבטל עם ↶", "ok");
    return;
  }
  if(act === "newdaf" && ta){ newDafDialog(sec, idx, ta); return; }
  if(act === "split" && ta){
    const pos = ta.selectionStart || 0;
    const before = sec.text.slice(0, pos).replace(/\s+$/, ""), after = sec.text.slice(pos).replace(/^\s+/, "");
    if(!after){ toast("שימו את הסמן במקום שבו הקטע החדש צריך להתחיל", "warn"); return; }
    sec.text = before;
    const ns = {id:uid("s"), kind: sec.kind === "chapter" ? "siman" : sec.kind, title:"", text:after};
    book.sections.splice(idx + 1, 0, ns);
    markDirty(); openSection(ns.id, false); scheduleLayout(200);
    toast("✓ הקטע חולק לשניים. מה שאחרי הסמן הוא עכשיו קטע משלו — אפשר לתת לו כותרת, או מראה משלו ב\"מראה כל הקטע\"", "ok");
    return;
  }
  if(!ta) return;
  if(act === "note" || act === "src") noteDialog(act === "src" ? "b" : "a", ta);
  else if(act === "bold") wrapSel(ta, "*", "*");
  else if(act === "sub") subHeadingAt(ta);
  else if(act === "side") sideHeading(ta);
  else if(act === "center") prefixLine(ta, "= ");
  else if(act === "sep") insertText(ta, "\n***\n");
  else if(act === "tag") wrapSel(ta, "<" + b.dataset.tag + ">", "</" + b.dataset.tag + ">");
  else if(act === "quote") prefixLine(ta, "> ");
  else if(act === "pagebreak") insertText(ta, "\n~~~\n");
  else if(act === "colbreak") insertText(ta, "\n~~\n");
}
function fireInput(ta){ ta.dispatchEvent(new Event("input", {bubbles:true})); }
function insertText(ta, text, at){
  const s = at != null ? at : ta.selectionStart, e = at != null ? at : ta.selectionEnd;
  ta.focus();
  ta.setRangeText(text, s, e, "end");
  fireInput(ta);
}
function wrapSel(ta, a, b){
  let s = ta.selectionStart, e = ta.selectionEnd;
  const v = ta.value;
  if(s === e){ while(s > 0 && !/\s/.test(v[s - 1])) s--; while(e < v.length && !/\s/.test(v[e])) e++; }
  if(s === e){ toast("סמנו את המילים שרוצים להדגיש", "warn"); return; }
  ta.focus();
  ta.setRangeText(a + v.slice(s, e) + b, s, e, "end");
  fireInput(ta);
}
// v1.9.01 (storm scan: a 150-word paragraph turned into one giant heading): «כותרת משנה» on a SHORT line (a title
// just typed) makes it the sub-heading; on a real paragraph it opens a new sub-heading line ABOVE it, cursor there
function subHeadingAt(ta){
  const v = ta.value, s0 = v.lastIndexOf("\n", ta.selectionStart - 1) + 1, e0 = v.indexOf("\n", ta.selectionStart), line = v.slice(s0, e0 < 0 ? v.length : e0);
  if(!line.trim() || /^#/.test(line.trim()) || line.trim().split(/\s+/).length <= 12){ prefixLine(ta, "# "); return; }
  ta.focus(); ta.setRangeText("# \n", s0, s0, "start"); ta.setSelectionRange(s0 + 2, s0 + 2); fireInput(ta);
  toast("נפתחה שורה לכותרת משנה מעל הפסקה — כתבו בה את הכותרת", "ok");
}
function prefixLine(ta, p){
  const v = ta.value;
  let s = ta.selectionStart;
  while(s > 0 && v[s - 1] !== "\n") s--;
  if(v.slice(s, s + p.length) === p){ ta.focus(); return; }
  ta.focus();
  ta.setRangeText(p, s, s, "end");
  fireInput(ta);
}
function sideHeading(ta){
  const v = ta.value;
  let s = ta.selectionStart, e = ta.selectionEnd;
  const sel = v.slice(s, e).trim();
  let ls = s;
  while(ls > 0 && v[ls - 1] !== "\n") ls--;
  if(v.slice(ls, ls + 2) === "[["){ ta.focus(); return; }
  const label = sel || "כותרת";
  ta.focus();
  if(sel) ta.setRangeText("", s, e, "end");
  ta.setRangeText("[[" + label + "]] ", ls, ls, "end");
  if(!sel){ ta.setSelectionRange(ls + 2, ls + 2 + label.length); }
  fireInput(ta);
}
function onContentInput(e){
  const f = e.target.dataset.f;
  if(!f) return;
  const sec = secOf(e.target);
  if(!sec) return;
  if(f === "text"){ sec.text = e.target.value; refreshHeadSoon(sec); markDirty(); scheduleLayout(); }
  else if(f === "title"){ sec.title = e.target.value; refreshHeadSoon(sec); markDirty(); scheduleLayout(); }
  else if(f === "masechet"){ book.masechet = e.target.value.trim(); markDirty(); scheduleLayout(); }
}
const refreshHeadSoon = debounce((sec) => refreshHead(sec), 400);
function onContentChange(e){
  const f = e.target.dataset.f;
  if(f === "cols" || f === "oddPage" || f === "head" || f === "pnumStart"){
    const sec = secOf(e.target); if(!sec) return;
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value.trim();
    if(f === "cols"){ if(v === "1" || v === "2") sec.cols = Number(v); else delete sec.cols; }
    else if(f === "oddPage"){ if(v) sec.oddPage = true; else delete sec.oddPage; }
    else if(f === "head"){ if(v) sec.head = v.slice(0, 120); else delete sec.head; }
    else if(f === "pnumStart"){ if(Number(v) > 0) sec.pnumStart = Math.round(Number(v)); else delete sec.pnumStart; }
    markDirty(); scheduleLayout(0);
    toast({cols: sec.cols ? "✓ הקטע הזה ב" + (sec.cols === 1 ? "טור אחד" : "שני טורים") + " (מתחיל בעמוד משלו)" : "✓ הטורים של הקטע — כמו בכל הספר",
      oddPage: sec.oddPage ? "✓ הקטע יתחיל בעמוד אי-זוגי" : "✓ הקטע ממשיך כרגיל",
      head: sec.head ? "✓ בעמודים של הקטע הזה הכותרת העליונה: «" + sec.head + "»" : "✓ הכותרת העליונה — כמו בכל הספר",
      pnumStart: sec.pnumStart ? "✓ מספרי העמודים מתחילים כאן מ-" + sec.pnumStart : "✓ מספרי העמודים ממשיכים כרגיל"}[f], "ok");
    return;
  }
  if(f === "look"){
    const sec = secOf(e.target);
    if(!sec) return;
    if(SEC_LOOK_CLS[e.target.value]) sec.look = e.target.value; else delete sec.look;
    markDirty(); scheduleLayout(0);
    const l = SEC_LOOKS.find(x => x[0] === (sec.look || ""));
    toast(sec.look ? "✓ הקטע הזה יודפס ב" + l[1] + ". שאר הספר כרגיל" : "✓ הקטע חזר למראה הרגיל של הספר", "ok");
    return;
  }
  if(f === "daf" || f === "amud"){
    const sec = secOf(e.target);
    if(!sec) return;
    if(f === "daf"){
      const n = parseInt(e.target.value, 10) || 0;
      if(n) sec.daf = n; else { delete sec.daf; delete sec.amud; }
    }else if(e.target.value) sec.amud = e.target.value;
    else delete sec.amud;
    const card = e.target.closest(".bk-sec"), tmp = h("div", null, dafRow(sec));
    const row = tmp.querySelector(".bk-dafrow"), hint = tmp.querySelector(".bk-dafhint");
    card.querySelector(".bk-dafrow").replaceWith(row);
    card.querySelector(".bk-dafhint").replaceWith(hint);
    row.querySelector("[data-f=\"" + f + "\"]").focus();
    refreshHead(sec); markDirty(); scheduleLayout(150);
    return;
  }
  if(f !== "kind") return;
  const sec = secOf(e.target);
  if(!sec) return;
  sec.kind = e.target.value;
  refreshHead(sec); markDirty(); scheduleLayout(150);
}
function showUndo(){
  const slot = $("bkUndoSlot");
  if(!slot) return;
  slot.innerHTML = "<div class=\"bk-undo\">הקטע נמחק. <button class=\"bk-btn bk-small\" type=\"button\" id=\"bkRestoreSec\">↶ שחזר</button></div>";
  $("bkRestoreSec").addEventListener("click", () => {
    if(!undoSec) return;
    book.sections.splice(Math.min(undoSec.idx, book.sections.length), 0, undoSec.sec);
    openSec = undoSec.sec.id; undoSec = null; slot.innerHTML = "";
    markDirty(); renderSections(); scheduleLayout(150);
  });
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { slot.innerHTML = ""; undoSec = null; }, 15000);
}

/* ------------------------------------------------------------ design tab */
function pills(key, options){
  return "<div class=\"bk-pills\">" + options.map(([v, l]) => `<button type="button" class="bk-pill${String(st[key]) === String(v) ? " on" : ""}" data-k="${key}" data-v="${esc(v)}">${l}</button>`).join("") + "</div>";
}
function stepper(key, step, min, max, unit){
  return `<div class="bk-step"><button type="button" data-step="${key}" data-d="${-step}" data-min="${min}" data-max="${max}" aria-label="הקטן">−</button><span>${st[key]} ${unit}</span><button type="button" data-step="${key}" data-d="${step}" data-min="${min}" data-max="${max}" aria-label="הגדל">+</button></div>`;
}
// a checkbox's own name, without its small explanation line
function chkName(t){ const l = t.closest("label"), c = l && l.querySelector("span"); let x = c ? c.cloneNode(true) : (l || t); if(x.querySelector) x.querySelectorAll("small").forEach(m => m.remove()); return (x.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50); }
function check(key, label, sub){
  // "הדגש דיבור המתחיל" here and "איפה" in the styles tab are ONE setting (before, a choice there silenced this box)
  const on = key === "bodyDibur" ? diburWhere(st) !== "none" : st[key];
  return `<label class="bk-check"><input type="checkbox" data-ck="${key}"${on ? " checked" : ""}/><span>${label}${sub ? "<small>" + sub + "</small>" : ""}</span></label>`;
}
function thumb(k){
  const L = (top, right, left, hgt) => `<i style="top:${top}px;right:${right}%;left:${left}%${hgt ? ";height:" + hgt + "px" : ""}"></i>`;
  let s = "";
  if(k === "twocol"){ for(let i = 0; i < 6; i++) s += L(8 + i * 8, 10, 54) + L(8 + i * 8, 54, 10); }
  else if(k === "shulchan"){
    for(let i = 0; i < 3; i++) s += L(7 + i * 8, 10, 10);
    s += L(33, 10, 62, 1);
    for(let i = 0; i < 4; i++) s += L(38 + i * 5, 10, 54, 2) + L(38 + i * 5, 54, 10, 2);
  }
  else if(k === "modern"){ for(let i = 0; i < 5; i++) s += L(8 + i * 10, i === 0 ? 18 : 10, 10); }
  else if(k === "kuntres"){ for(let i = 0; i < 6; i++) s += L(8 + i * 8, 24, 24); }
  else if(k.startsWith("daf") && k !== "daf1"){
    s += L(6, 62, 12, 5);                                   // the daf heading
    for(let i = 0; i < 5; i++) s += L(15 + i * 7, 10, 54, i === 1 ? 3 : 2) + L(15 + i * 7, 54, 10, 2);
    if(k === "dafNotes") s += L(6, 10, 54, 5).replace("top:6px", "top:6px;background:#111") + L(51, 10, 10, 1);
  }
  else if(k === "daf1" || k === "dafModern"){
    s += L(5, 30, 30, 6);
    for(let i = 0; i < 5; i++) s += L(16 + i * 8, i === 0 ? 22 : 10, 10, 2);
  }
  else if(k === "halacha"){
    s += L(8, 4, 80, 5) + L(26, 4, 80, 5);
    for(let i = 0; i < 4; i++) s += L(8 + i * 8, i === 0 || i === 2 ? 26 : 22, 8);
    s += L(41, 22, 62, 1) + L(45, 22, 8, 2) + L(50, 22, 8, 2);
  }
  else if(k === "old"){ for(let i = 0; i < 6; i++) s += L(8 + i * 8, 10, 54, i % 3 === 0 ? 4 : 2) + L(8 + i * 8, 54, 10, i === 3 ? 4 : 2); }
  else{
    for(let i = 0; i < 4; i++) s += L(8 + i * 8, 10, 10);
    s += L(42, 10, 62, 1);
    for(let i = 0; i < 3; i++) s += L(46 + i * 5, 10, 54, 2) + L(46 + i * 5, 54, 10, 2);
  }
  return s;
}
// "what the program decided by itself in THIS book" — each automatic rule, how many paragraphs it took,
// and its switch. Nothing is decided out of sight: a rule that swallows a choice is visible here.
function fillDetect(){
  const el = document.getElementById("bkDetect");
  if(!el || !st) return;
  const D = DETECT || {};
  // on = the value of st[k] that means "the rule is working"
  const row = (n, k, on, what, offTxt) => {
    const active = on ? st[k] !== false : !st[k];
    if(!n && active) return "";
    return `<label class="bk-check bk-detrow"><input type="checkbox" data-detect="${k}" data-name="${esc(what.split(" — ")[0])}" data-on="${on ? 1 : 0}"${active ? " checked" : ""}/><span><b>${n || ""}</b> ${what}<small>${active ? offTxt : "כבוי — הסימון מחזיר"}</small></span></label>`;
  };
  const rows = [
    row(D.digit, "digitHang", true, "פסקאות מתחילות בספרה (1. 2. 3.) — מודגשות עד הנקודתיים, והשורות שאחריהן מוזחות", "להוריד את הסימון: הן ייראו כמו כל פסקה"),
    row(D.num, "numLabels", true, "פסקאות מתחילות במספר סעיף (א. ב.) — המספר גדול ומודגש", "להוריד את הסימון: המספר ייראה כמו שאר הטקסט"),
    row(D.item, "itemLabels", true, "פסקאות מתחילות ב-(א) (ב) — כמו רשימה", "להוריד את הסימון: הן ייראו כמו כל פסקה"),
    !st.pasukCenter ? "" : row(D.pasuk, "pasukCenter", true, "שורות זוהו כפסוק — במרכז ומודגשות", "להוריד את הסימון: הפסוק ייראה כמו כל פסקה"),
    row(D.dibLine, "diburLineJoin", true, "שורות קצרות (עד 4 מילים) חוברו לפסקה שמתחתיהן כדיבור המתחיל", "להוריד את הסימון: כל שורה קצרה תישאר שורה בפני עצמה"),
    D.itemNoDib || st.diburOnItems ? row(D.itemNoDib, "diburOnItems", false, "פסקאות (א) (ב) — בלי דיבור המתחיל", "להוריד את הסימון: גם בהן יודגש הדיבור המתחיל") : "",
    D.noDib ? `<div class="bk-detrow bk-detinfo"><b>${D.noDib}</b> פסקאות בלי דיבור המתחיל — לא נמצא בהן סימן הסיום (${esc(diburMarksText(st))}) מספיק קרוב לתחילת הפסקה<small><button type="button" class="bk-link" data-godib="1">לבחור סימן אחר או מספר מילים קבוע ← בלשונית 🖋 סגנונות</button></small></div>` : "",
    st.openerEvery && st.opener !== "none" ? row(D.afterNum, "openerAfterNum", false, "פסקאות ביאור שאחרי מספר — בלי פתיחת פסקה", "להוריד את הסימון: גם הן יפתחו בפתיחה שנבחרה") : ""
  ].filter(Boolean);
  const html = rows.length ? `<h4 class="bk-h4">🔎 מה התוכנה זיהתה לבד בספר הזה (מתוך ${D.paras || 0} פסקאות)</h4>` + rows.join("") : "";
  if(el.dataset.html === html) return;      // unchanged: do not touch the panel (it would move under the mouse)
  el.dataset.html = html; el.innerHTML = html;
  el.querySelectorAll("[data-godib]").forEach(b => b.addEventListener("click", () => { const g = document.getElementById("bkDibGo"); if(g) g.click(); else { const t = document.querySelector('[data-tab="styles"]'); if(t) t.click(); } }));
  el.querySelectorAll("[data-detect]").forEach(cb => cb.addEventListener("change", () => {
    const k = cb.dataset.detect, on = cb.dataset.on === "1";
    st[k] = cb.checked ? on : !on;
    markDirty(); scheduleLayout(0); reportChange(cb.dataset.name + (cb.checked ? " — פועל" : " — כבוי"), k);
  }));
}
function renderDesign(){
  const P = $("bkPanelDesign");
  if(!st) return;
  const sizeIsPreset = PAGE_SIZES.some(p => p.k === st.pageSize);
  const card = (t) => `<button type="button" class="bk-tpl${st.template === t.k ? " on" : ""}" data-tpl="${t.k}">
     <div class="bk-thumb">${thumb(t.k)}</div><b>${t.name}</b><small>${t.desc}</small></button>`;
  const tplsDaf = TEMPLATES.filter(t => t.group === "daf").map(card).join("");
  const tplsMore = TEMPLATES.filter(t => t.group !== "daf").map(card).join("");
  P.innerHTML = `
${helpBox("design")}
<div class="bk-btype-row">${(() => { const T = BOOK_TYPES.find(x => x.k === st.bookType); return "📚 סוג הספר: <b>" + (T ? T.icon + " " + esc(T.name) : "עוד לא נבחר") + "</b>"; })()}
  <button type="button" class="bk-btn bk-primary" data-pickbtype="1">${st.bookType ? "לשנות את סוג הספר" : "לבחור איזה ספר זה"}</button>
  <small>כל סוג מביא את העיצוב שמתאים לו. הטקסט לא משתנה, ואפשר לבטל עם ↶.</small></div>
<div class="bk-likemain"><button type="button" class="bk-btn bk-primary bk-big" data-likemain="1">📖 לעצב כמו הספר שאני עובד עליו</button>
  <small>לוקח את כל העיצוב מהספר שפותחים הכי הרבה (למשל עושה חיל). הטקסט והשער לא משתנים. אפשר לבטל עם ↶.</small></div>
<h3 class="bk-h" data-fold="look">📖 חידושים על הדף — בהשראת "שיעורים יומיים"</h3>
<div class="bk-tpls">${tplsDaf}</div>
<h3 class="bk-h">🎨 עוד סגנונות מספרים קיימים</h3>
<div class="bk-tpls">${tplsMore}</div>
<h3 class="bk-h">📏 גודל הספר</h3>
${pills("pageSize", PAGE_SIZES.map(p => [p.k, p.label + (p.note ? " · " + p.note : "")]).concat([["custom","גודל אחר…"]]))}
${!sizeIsPreset ? `<div class="bk-two" style="margin-top:8px"><label class="bk-field">רוחב (מ"מ)<input class="bk-input" type="number" data-num="pageW" value="${st.pageW}" min="80" max="420"/></label><label class="bk-field">גובה (מ"מ)<input class="bk-input" type="number" data-num="pageH" value="${st.pageH}" min="100" max="600"/></label></div>` : ""}
<h3 class="bk-h">🔤 אותיות הטקסט</h3>
<div class="bk-sub">
  <label class="bk-field">גופן<select class="bk-select" data-sel="bodyFont">${fontOptions(st.bodyFont)}</select></label>
  <div class="bk-row">גודל אות: ${stepper("bodySize", 0.5, 8, 22, "נק'")}</div>
  <div>מרווח בין השורות: ${pills("lineHeight", [[1.4,"צפוף"],[1.55,"רגיל"],[1.75,"מרווח"]])}</div>
</div>
<h3 class="bk-h" data-fold="look">📄 העמוד</h3>
<div class="bk-sub">
  <div>שוליים: ${pills("margins", [["narrow","צרים"],["normal","רגילים"],["wide","רחבים"]])}</div>
  <div>טורים: ${pills("columns", [[1,"טור אחד"],[2,"שני טורים"]])}</div>
  ${Number(st.columns) === 2 ? `<div>קו בין הטורים: ${pills("colRule", [["none","בלי"],["thin","קו דק"],["double","קו כפול"]])}</div>` : ""}
</div>
<h3 class="bk-h" data-fold="para">¶ פסקאות</h3>
<div class="bk-sub">
  <div><button type="button" class="bk-btn bk-primary" id="bkTorahLookBtn">📜 עיצוב של פירוש על התורה — לכל הספר</button>
    <small class="bk-tpnote">הפסוק במרכז ומודגש; כל קטע פותח במילה בחלון והשורה השנייה מוזחת לידה; מודגש עד הנקודתיים; שני טורים</small></div>
  <div>חלוקה לפסקאות: ${pills("paraJoin", [["","אוטומטי — מזהה לבד"],["line","כל שורה היא פסקה"],["section","כל קטע פסקה אחת"],["pasuk","📜 כל קטע פותח בציטוט פסוק עד סימן"]])}</div>
  <div><button type="button" class="bk-btn" id="bkParaDefBtn">📑 להגדיר לכל הספר: מה פסקה ומה ציטוט</button>
    <small class="bk-tpnote">${(st.quoteByQuotes || st.quoteByIndent || quoteWordList(st).length) ? "ציטוט " + (st.quoteInline ? "בתוך הקטע" : "כקטע נפרד") + " לפי: " + [st.quoteByQuotes ? "מירכאות" : "", st.quoteByIndent ? "רווחים בתחילת שורה" : "", quoteWordList(st).length ? "המילים " + esc(quoteWordList(st).join(", ")) : ""].filter(Boolean).join(" · ") : "ציטוט = שורה שמתחילה ב-&gt; בלבד"}</small></div>
  <div>פסקאות: ${pills("paraStyle", [["gap","רווח קטן בין פסקאות"],["indent","הזחת שורה ראשונה"],["hang","הזחת שורה שנייה (כמו בספרים)"],["none","צמודות"]])}</div>
  <div>פתיחת פסקה: ${pills("opener", [["letter","אות ראשונה גדולה"],["window","חלון — מילה ראשונה מודגשת והשורה השנייה מוזחת (כמו בעושה חיל)"],["big","מילה ראשונה גדולה"],["drop","מילה ענקית בשתי שורות"],["bold","מילה ראשונה מודגשת"],["none","רגיל"]])}</div>
  ${check("openerEvery", "פתיחה כזו בכל פסקה חדשה", "לא רק אחרי כותרת. הביאור שבא מיד אחרי דיבור ממוספר נשאר רגיל")}
  <div class="bk-sample" id="bkSample" aria-live="polite"></div>
  <div class="bk-detect" id="bkDetect"></div>
</div>
<h3 class="bk-h" data-fold="heads">🏷 צורת הכותרות</h3>
<div class="bk-sub">
  <div>כותרת פרק / דף: ${pills("chapterLook", [["plain","רגילה"],["daf","קטנה עם ★ ☆ ★"],["outline","אותיות חלולות"],["ornament","עם קישוטים ❖"],["banner","פס שחור"],["lines","בין שני קווים"],["frame","במסגרת"],["cartouche","מסגרת מעוטרת (תלתלים)"]])}</div>
  <div>כותרת סימן / נושא: ${pills("simanLook", [["plain","רגילה"],["classic","סימן קטן ושם גדול"],["underline","עם קו מתחת"],["lines","בין שני קווים"],["curls","המספר בין תלתלים"]])}</div>
  ${check("chapterSpan", "כותרת הפרק על פני שני הטורים", "כשמבוטל — הכותרת יושבת בתוך הטור, כמו \"דף ב' ע\"ב\" בשיעורים יומיים")}
  ${check("chapterNewPage", "כל פרק מתחיל בעמוד חדש")}
  ${check("chapterOdd", "כל פרק מתחיל בעמוד אי-זוגי", "בצד השמאלי של הספר הפתוח, כמו בספרים מודפסים; אם צריך — עמוד ריק לפניו")}
  ${check("frontNum", "ההקדמה וההסכמות ממוספרות לחוד", "גוף הספר מתחיל שוב מעמוד א")}
</div>
<h3 class="bk-h" data-fold="para">📑 סימנים וסעיפים</h3>
<div class="bk-sub">
  <div>כותרת סימן: ${pills("simanStyle", [["center","באמצע, בשורה נפרדת"],["inline","בתחילת הפסקה (כמו בספרים הישנים)"]])}</div>
  ${check("numLabels", "הדגש מספרי סעיפים", "פסקה שמתחילה ב\"א.\" \"ב.\" — המספר יוצא גדול ומודגש")}
  ${check("digitHang", "פסקה שמתחילה בספרה (1. 2. 3.)", "מודגשת עד הנקודתיים, והשורות שאחריה מוזחות")}
  ${check("bodyDibur", "הדגש דיבור המתחיל בכל פסקה", "המילים הראשונות עד " + esc(diburMarksText(st)) + " — איזה סימן, ואם הוא ציטוט מפסוק: בלשונית 🖋 סגנונות ← דיבור המתחיל")}
  ${check("emphSquare", "הדגשות באותיות מרובעות", "מתאים כשהטקסט באותיות רש\"י")}
  ${check("centerLastLine", "מרכז את השורה האחרונה של כל סימן", "כמו \"ודו\"ק\" בסוף קטע בספרים הישנים")}
  ${check("centerEvery", "מרכז את השורה האחרונה של כל פסקה", "כמו בשיעורים יומיים")}
</div>
<h3 class="bk-h" data-fold="heads">📝 הערות בתחתית העמוד</h3>
<div class="bk-sub">
  <label class="bk-field">גופן ההערות<select class="bk-select" data-sel="noteFont">${fontOptions(st.noteFont)}</select></label>
  <div class="bk-row">גודל: ${stepper("noteSize", 0.5, 6, 16, "נק'")}</div>
  <div>טורים: ${pills("noteCols", [[1,"טור אחד"],[2,"שני טורים"],[3,"שלושה טורים"]])}</div>
  <div>סימון: ${pills("noteMarker", [["num","1 2 3"],["letters","א ב ג"],["paren","(א) (ב) (ג)"]])}</div>
  <div>סידור: ${pills("noteFlow", [["block","כל הערה בשורה חדשה"],["runin","הערות רצופות — חוסך מקום"]])}</div>
  <div>איפה ההערות: ${pills("notesPlace", [["","בתחתית העמוד"],["chapter","בסוף כל פרק"],["book","בסוף הספר"]])}</div>
  <div>הקו מעל ההערות: ${pills("noteSep", [["short","קו קצר"],["full","קו לכל הרוחב"],["orn","קו עם ❖"],["text","כותרת"],["none","בלי"]])}</div>
  <label class="bk-field">המספור מתחיל מחדש
    <select class="bk-select" data-sel="notesNumbering">
      ${[["chapter","בכל פרק"],["siman","בכל סימן"],["page","בכל עמוד"],["book","רציף בכל הספר"]].map(([v, l]) => `<option value="${v}"${st.notesNumbering === v ? " selected" : ""}>${l}</option>`).join("")}
    </select></label>
  ${check("noteDibur", "הדגש את הדיבור המתחיל בכל הערה", "המילים שעד המקף (–) או עד הנקודה הראשונה")}
</div>
<h3 class="bk-h" data-fold="heads">🔢 כותרות ומספרי עמודים</h3>
<div class="bk-sub">
  <div>כותרת בראש העמוד: ${pills("headerMode", [["both","שם הספר ושם הפרק"],["split","שם הספר בשני הצדדים"],["chapter","שם הפרק בלבד"],["none","בלי"]])}</div>
  ${st.headerMode === "split" ? `<div>באמצע הכותרת: ${pills("headerCenter", [["chapter","הפרק / הדף"],["siman","הסימן / הנושא"]])}</div>` : ""}
  <div>מספרי עמודים: ${pills("pageNumbers", [["hebrew","א ב ג"],["digits","1 2 3"],["leaf","דפים (מספר לכל דף)"],["none","בלי"]])}</div>
  <div>מקום המספר: ${pills("pageNumPos", [["bottom","למטה באמצע"],["top","למעלה בצד"]])}</div>
  <div>צורת המספר: ${pills("pnumFormat", [["plain","יב"],["dash","- יב -"],["bracket","[יב]"],["paren","(יב)"],["diamond","◆ יב ◆"]])}</div>
  <div class="bk-tpentry"><button type="button" class="bk-btn bk-primary" data-tpopen="1">🎨 סטודיו שער הספר</button>
    <small>נפתח בחלון מלא משלו: ${TP_PRESETS.length} דוגמאות גדולות לבחירה, שינוי הכתוב, ועיצוב חופשי</small></div>
  ${check("autoNumber", "מספר אוטומטית פרקים וסימנים", "פרק א, פרק ב… סימן א, סימן ב…")}
  ${check("index", "מפתח מקורות בסוף הספר", "כל מקום בגמרא ובתנ\"ך שמוזכר בספר, עם מספרי העמודים שבהם הוא מופיע")}
</div>
<details class="bk-adv bk-adv-only"${lsGet("bk_adv", "0") === "1" ? " open" : ""}><summary>⚙ אפשרויות מקצועיות</summary><div>
  ${check("catchword", "שומר הדף", "המילה הראשונה של העמוד הבא מודפסת בתחתית העמוד")}
  ${check("noLonelyWord", "בלי מילה בודדת בשורה האחרונה של פסקה")}
  ${check("widows", "בלי שורה בודדת בראש עמוד או בתחתיתו")}
  ${check("sourcesSmall", "מראי מקומות בסוגריים ( ) באות קטנה")}
  ${check("noHeaderOnChapter", "בלי כותרת עליונה בעמוד שפרק מתחיל בו")}
  ${check("headerRule", "קו מתחת לכותרת העליונה")}
  ${check("hideNikud", "הסתר ניקוד", "הטקסט עצמו נשאר עם ניקוד — רק לא מודפס")}
  ${check("hideTeamim", "הסתר טעמי המקרא")}
  ${check("titlePage", "שער הספר (עמוד שם הספר)", "נכתב לפי \"פרטי הספר\"")}
  ${check("cropMarks", "סימני חיתוך לבית הדפוס", "רק בקובץ ה-PDF")}
  <label class="bk-field">תוכן העניינים
    <select class="bk-select" data-sel="toc">${[["end","בסוף הספר"],["start","בתחילת הספר"],["none","בלי"]].map(([v, l]) => `<option value="${v}"${st.toc === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
  <label class="bk-field">גופן הכותרות<select class="bk-select" data-sel="headFont">${fontOptions(st.headFont)}</select></label>
  <div class="bk-two"><label class="bk-field">המילה לפני מספר פרק<input class="bk-input" data-txt="chapterWord" value="${esc(st.chapterWord)}"/></label>
  <label class="bk-field">המילה לפני מספר סימן<input class="bk-input" data-txt="simanWord" value="${esc(st.simanWord)}"/></label></div>
</div></details>`;
  const adv = P.querySelector(".bk-adv");
  if(adv) adv.addEventListener("toggle", () => lsSet("bk_adv", adv.open ? "1" : "0"));
  foldDesign(P);
  tidyChoices(P);
  railFilterDesign();   // a choice re-renders the panel: keep showing only the chosen topic
  const pdb = P.querySelector("#bkParaDefBtn");
  if(pdb) pdb.addEventListener("click", () => paraDefDialog());
  showSample(st.paraStyle, st.opener, "כך זה נראה עכשיו:");
  fillDetect();
  P.querySelectorAll("[data-txt]").forEach(inp => inp.addEventListener("input", () => {
    st[inp.dataset.txt] = inp.value.trim(); markDirty(); scheduleLayout();
  }));
}
// v1.8.78 (Eli 11-01, accessibility): the design tab in three folds, only one open at a time,
// so Abba sees a short list instead of 110 controls. The open fold is remembered.
const DESIGN_FOLDS = [
  ["look", "📄 איך הספר נראה", "דוגמאות מוכנות, גודל הספר, אותיות, שוליים וטורים"],
  ["para", "¶ פסקאות ופתיחה", "הזחה, אות ראשונה גדולה, סעיפים ודיבור המתחיל"],
  ["heads", "🏷 כותרות, הערות ומספרי עמודים", "צורת הכותרות, הערות בתחתית העמוד, מספרי עמודים ושער"],
];
// rarely-needed choices: shown only with "להציג את כל הכפתורים"
const DESIGN_ADV = ["colRule", "emphSquare", "centerLastLine", "centerEvery", "noteFont", "noteSep", "noteFlow", "noteDibur", "headerCenter", "pnumFormat", "chapterSpan"];
// v1.9.01 (Eli 03.11, "מבולבל ולא מקצועי"): one look for every choice in the design panel.
// Label on its own line; 2-4 short options = one segmented bar; longer ones = a list with a radio dot
// and the "(…)" / "— …" part as a grey hint. Only the DOM look changes: data-k/data-v and .on stay.
function tidyChoices(P){
  P.querySelectorAll(".bk-pills").forEach(g => {
    if(g.dataset.tidy) return; g.dataset.tidy = "1";
    const host = g.parentElement;
    if(host && host.firstChild && host.firstChild.nodeType === 3 && host.firstChild.textContent.trim()){
      const lb = document.createElement("span"); lb.className = "bk-lb";
      lb.textContent = host.firstChild.textContent.replace(/[:\s]+$/, "").trim();
      host.replaceChild(lb, host.firstChild);
    }
    const bs = [...g.querySelectorAll(".bk-pill[data-k]")];
    if(!bs.length) return;
    const short = bs.length <= 4 && bs.every(b => b.textContent.trim().length <= 12);
    g.classList.add(short ? "bk-seg" : "bk-olist");
    bs.forEach(b => {
      b.setAttribute("aria-pressed", String(b.classList.contains("on")));
      if(short) return;
      let t = b.textContent.trim(), h = "";
      let m = t.match(/^(.+?)\s*\((.+)\)$/);
      if(m && !/^\(/.test(t)){ t = m[1]; h = m[2]; }
      if((m = t.match(/^(.+?)\s+—\s+(.+)$/))){ t = m[1]; h = m[2] + (h ? " · " + h : ""); }
      b.innerHTML = '<span class="bk-odot" aria-hidden="true"></span><span class="bk-ot">' + esc(t) + (h ? " <small>" + esc(h) + "</small>" : "") + "</span>";
    });
  });
  P.querySelectorAll(".bk-check").forEach(c => c.classList.add("bk-sw"));
}
function foldDesign(P){
  for(const k of DESIGN_ADV){
    const c = P.querySelector(`[data-k="${k}"],[data-ck="${k}"],[data-sel="${k}"]`);
    let w = c;
    while(w && w.parentElement && !w.parentElement.classList.contains("bk-sub")) w = w.parentElement;
    if(w && w.parentElement) w.classList.add("bk-adv-only");
  }
  const open = lsGet("bk_fold", "");  // first visit: all three closed, so the three names show at once
  const box = {};
  for(const [k, name, sub] of DESIGN_FOLDS){
    const d = document.createElement("details");
    d.className = "bk-fold"; d.dataset.fold = k;
    if(k === open) d.open = true;
    d.innerHTML = `<summary><span><b>${name}</b><small>${sub}</small></span></summary><div class="bk-foldbody"></div>`;
    box[k] = d;
  }
  const adv = P.querySelector(".bk-adv");
  let cur = null;
  for(const n of [...P.children]){
    if(n === adv){ cur = null; continue; }
    if(n.matches("h3.bk-h[data-fold]")) cur = n.dataset.fold;
    if(cur && box[cur]) box[cur].lastElementChild.appendChild(n);
  }
  for(const [k] of DESIGN_FOLDS) P.insertBefore(box[k], adv);
  P.querySelectorAll(".bk-fold").forEach(d => d.addEventListener("toggle", () => {
    if(!d.open || currentTopic !== "all") return;
    lsSet("bk_fold", d.dataset.fold);
    P.querySelectorAll(".bk-fold").forEach(x => { if(x !== d) x.open = false; });
    d.scrollIntoView({block: "nearest"});
  }));
}
function unfoldTo(el){
  const d = el && el.closest(".bk-fold");
  if(d && !d.open) d.open = true;
}
// what the pages LOOK like: their content, and the look of every paragraph on screen (many
// choices change only the style sheet — an indent, a gap — never the page's HTML)
function pagesSig(){
  let h = 2166136261;
  const mix = (t) => { for(let i = 0; i < t.length; i += 3){ h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= t.length; };
  for(const P of lastPages) mix(P.el ? P.el.innerHTML : "");
  let n = 0;
  for(const el of document.querySelectorAll("#bkViewer .bk-p, #bkViewer .bk-open, #bkViewer [class^=\"bk-h\"]")){
    if(++n > 600) break;
    const c = getComputedStyle(el);
    mix(c.textIndent + c.paddingRight + c.marginTop + c.marginBottom + c.fontSize + c.fontWeight + c.fontFamily + c.textAlign + c.lineHeight);
  }
  let m = 0;
  for(const el of document.querySelectorAll("#bkViewer .bk-page, #bkViewer .bk-flow, #bkViewer .bk-notes, #bkViewer .bk-head, #bkViewer .bk-foot, #bkViewer .bk-pnum, #bkViewer .bk-mk")){
    if(++m > 400) break;
    const c = getComputedStyle(el), b = getComputedStyle(el, "::before"), a = getComputedStyle(el, "::after");
    mix(el.className + c.columnRuleStyle + c.columnRuleWidth + c.columnCount + c.borderTopStyle + c.borderBottomStyle + c.borderBottomWidth + c.fontSize
      + c.fontWeight + c.textAlign + c.top + c.bottom + c.display + b.content + b.borderTopStyle + b.width + a.content + a.borderTopStyle);
  }
  return h >>> 0;
}
// the name of a choice as the person sees it: "<group>: <option>"
function choiceName(el){
  const opt = (el.textContent || "").replace(/\s+/g, " ").trim();
  let grp = "";
  const ctl = el.closest(".bk-ctl"); if(ctl){ const l = ctl.querySelector(".bk-ctl-l"); if(l) grp = l.textContent.trim(); }
  if(!grp){ const d = el.closest(".bk-pills"); const lb = d && d.parentElement && d.parentElement.querySelector(":scope > .bk-lb"); if(lb) grp = lb.textContent.trim(); }
  if(!grp){ const d = el.closest(".bk-pills"); const host = d && d.parentElement; if(host && host.firstChild && host.firstChild.nodeType === 3) grp = host.firstChild.textContent.replace(/[:\s]+$/, "").trim(); }
  return (grp ? grp + ": " : "") + opt;
}
// after a choice: tell in plain words what changed, or WHY this book shows no difference
const PARA_DETECT_KEYS = /^(opener|openerEvery|openerWords|paraStyle|bodyDibur|diburWhere|diburUntil|diburMarks|@dib|numLabels|digitHang|centerEvery|centerLastLine|el\.(dibur|opener|num)\.)/;
function noChangeReason(key){
  const V = $("bkViewer"), has = (sel) => !!(V && V.querySelector(sel));
  const k = String(key || "");
  if(/^cropMarks/.test(k)) return "סימני החיתוך מופיעים רק בקובץ ה-PDF להדפסה, לא על המסך";
  if(/^(note|el\.notes)/.test(k) && !has(".bk-note")) return "בספר הזה עדיין אין הערות שוליים — זה יחול כשיהיו";
  if(/^(siman|hideSiman|el\.h2)/.test(k) && !has(".bk-h2")) return "בספר הזה אין כותרות סימן — זה יחול כשיהיו";
  if(/^(chapter|hideChapter|el\.h1)/.test(k) && !has(".bk-h1")) return "בספר הזה אין כותרות פרק — זה יחול כשיהיו";
  if(/^(sub|el\.h3)/.test(k) && !has(".bk-h3")) return "בספר הזה אין כותרות משנה — זה יחול כשיהיו";
  if(/^(el\.dibur|dibur)/.test(k) && !has(".bk-dib")) return "בספר הזה אין «דיבור המתחיל» — זה יחול כשיהיה (בחירה ב«איפה» למעלה)";
  if(/^colRule/.test(k) && Number(st.columns) !== 2) return "הקו בין הטורים מופיע רק כשהספר בשני טורים";
  if(/^widows/.test(k)) return "בעמודים של הספר הזה אין כרגע שורה בודדת שזה משנה";
  if(/^titlePage/.test(k)) return "השער מוצג בלשונית «שער» ובקובץ ה-PDF";
  if(/^el\.(daf)|^daf/.test(k) && !has(".bk-hdaf")) return "בספר הזה אין קטעים עם «דף בגמרא»";
  const D = DETECT || {}, held = (D.digit || 0) + (D.item || 0) + (D.pasuk || 0) + (D.afterNum || 0) + (D.noDib || 0) + (D.itemNoDib || 0);
  if(PARA_DETECT_KEYS.test(k) && held) return "DETECT";
  return "";
}
function reportChange(name, key){
  const before = pagesSig();
  setTimeout(async () => {
    await waitLayout();
    if(!lastPages.length) return;
    if(pagesSig() === before){
      // say WHY, truly: the thing is not in this book, it shows only in the PDF, an automatic paragraph rule holds
      // those paragraphs (only for a paragraph choice), or it simply already looked so
      const why = noChangeReason(key), det = document.getElementById("bkDetect");
      if(why === "DETECT" && det && det.innerHTML){
        toast("«" + name + "» לא שינה את הדפים: חלק מהפסקאות בספר הזה מעוצבות לפי זיהוי אוטומטי. אפשר לכבות אותו ב«🔎 מה התוכנה זיהתה לבד» (מסומן עכשיו)", "warn");
        det.classList.add("bk-flash"); det.scrollIntoView({block:"nearest", behavior:"smooth"}); setTimeout(() => det.classList.remove("bk-flash"), 2500);
      }else if(why && why !== "DETECT") toast("«" + name + "» נשמר. " + why, "ok");
      else toast("«" + name + "» — כך זה כבר נראה בספר הזה, אין מה לשנות", "ok");
    }
    else toast("✓ " + name + " — הספר עודכן", "ok");
  }, 260);
}
function styleChanged(rerender, focusSel){
  markDirty();
  scheduleLayout(120);
  if(rerender){
    renderDesign();
    if(focusSel){ const f = $("bkPanelDesign").querySelector(focusSel); if(f){ unfoldTo(f); f.focus({preventScroll:true}); } }
  }
}

// C1: a small live example of the paragraph look, shown while hovering a choice
const SAMPLE_TXT = ["ויקרא אלקים לאור יום מלמד שנתעטף הקדוש ברוך הוא בטלית לבנה והבהיק מזיוו, ואותו אור נגנז לצדיקים לעתיד לבוא.",
  "ויש לך להתבונן איך הוסיף באור ואמר על הארץ ועל פני רקיע השמים, וכאילו אמר מה שהוא אומר על הארץ פירושו על פני הרקיע."];
function sampleHTML(ps, op){
  const P = (txt, first) => {
    const w = txt.split(" "), head = w[0], rest = w.slice(1).join(" ");
    let open = head + " ";
    const showOp = op !== "none" && (first || st.openerEvery || op === "letter" || op === "window");
    if(showOp){
      if(op === "letter") open = `<b style="font-size:1.75em;line-height:.8">${head[0]}</b>${head.slice(1)} `;
      else if(op === "window") open = `<b style="float:right;text-indent:0;font-size:1.18em;line-height:1.1;height:2.5em;margin-left:.25em">${head}</b>`;
      else if(op === "big") open = `<b style="font-size:1.45em;line-height:.9">${head}</b> `;
      else if(op === "drop") open = `<b style="float:right;text-indent:0;font-size:2.6em;line-height:1;margin-left:.15em">${head}</b>`;
      else if(op === "bold") open = `<b>${head}</b> `;
    }
    const css = ps === "indent" ? "text-indent:1.4em;margin:0" : ps === "hang" ? "padding-right:1.4em;text-indent:-1.4em;margin:0"
      : ps === "gap" ? "margin:0 0 .45em" : "margin:0";
    return `<p style="${css};text-align:justify">${open}${rest}</p>`;
  };
  return `<div class="bk-sample-in">${P(SAMPLE_TXT[0], true)}${P(SAMPLE_TXT[1], false)}</div>`;
}
function showSample(ps, op, note){
  const box = $("bkSample"); if(!box) return;
  // the box never shrinks while the mouse moves over the choices: a shorter sample made everything above the
  // pointer jump, and a click landed on a different button (caught by the acceptance gate, 11-02)
  box.style.minHeight = Math.max(parseFloat(box.style.minHeight) || 0, box.offsetHeight) + "px";
  // v1.8.88 (Eli: "האות הגדולה נראית בתצוגה המקדימה אבל לא בפועל"): the CURRENT look is shown on this book's own
  // paragraphs, copied from its laid-out pages — what is shown is what prints. A choice under the mouse keeps
  // the general sample, marked as such.
  if(ps === st.paraStyle && op === st.opener && realSample(box)) return;
  box.dataset.html = "";
  box.innerHTML = `<div class="bk-sample-h">${esc(note || "כך זה ייראה:")}</div>` + sampleHTML(ps, op) +
    `<small class="bk-tpnote">דוגמה כללית — אחרי הבחירה רואים כאן את הפסקאות של הספר עצמו</small>`;
}
function realSample(box){
  const pages = (lastPages || []).map(P => P.el).filter(Boolean);
  if(!pages.length) return false;
  const all = [].concat(...pages.map(el => [...el.querySelectorAll(".bk-p:not(.bk-cont):not(.bk-center):not(.bk-quote)")]));
  const plain = all.find(p => !p.classList.contains("bk-hang") && !p.querySelector(".bk-num,.bk-ilabel"));
  const numd = all.find(p => p !== plain && (p.classList.contains("bk-hang") || p.querySelector(".bk-num,.bk-ilabel")));
  const pick = [plain, numd].filter(Boolean);
  if(!pick.length) return false;
  const w = Math.max(...pick.map(p => p.offsetWidth)) || 300;
  const D = DETECT || {};
  const html = `<div class="bk-sample-h">כך זה נראה עכשיו — בפסקאות של הספר הזה:</div>
    <div class="bk-sample-real"><div class="bk-page" style="position:static;width:100%;max-width:${w}px;height:auto;overflow:visible;padding:6px 0"><div class="bk-flow" style="column-count:1">${pick.map(p => p.outerHTML).join("")}</div></div></div>
    <small class="bk-tpnote">${st.opener !== "none" ? "פתיחת הפסקה מופיעה ב-" + (D.opened || 0) + " מתוך " + (D.paras || 0) + " פסקאות" + (D.opened < D.paras ? " — מה שלא קיבל אותה מפורט מתחת" : "") : ""}</small>`;
  if(box.dataset.html !== html){ box.dataset.html = html; box.innerHTML = html; }
  return true;
}
function onDesignClick(e){
  if(e.target.closest("[data-pickbtype]")){
    bookTypeDialog(k => {
      const T = BOOK_TYPES.find(x => x.k === k);
      confirmBox("לעצב את הספר הזה כ" + T.icon + " " + T.name + "?",
        "העיצוב של הספר יוחלף בעיצוב של «" + esc(T.name) + "». הטקסט, השער והסגנונות שנבחרו לפסקאות לא משתנים. אפשר לבטל עם ↶.",
        "✓ לעצב כך", () => { setBookType(k).then(() => { if(currentTab === "design") renderDesign(); }); });
    });
    return;
  }
  if(e.target.closest("[data-likemain]")){
    (async () => {
      const m = await mainBookStyle(book.id);
      if(!m){ toast("לא מצאתי ספר אחר עם עיצוב לקחת ממנו", "warn"); return; }
      const before = pagesSig(), tp = st.tp;
      for(const k of Object.keys(st)) delete st[k];
      Object.assign(st, DEFAULT_STYLE, m.style); if(tp) st.tp = tp; else delete st.tp;
      styleChanged(true);
      await new Promise(r => setTimeout(r, 260)); await waitLayout();
      toast((pagesSig() === before ? "העיצוב כבר היה כמו ב«" : "✓ עכשיו הספר מעוצב כמו «") + m.title + "» — אפשר לבטל עם ↶", "ok");
    })();
    return;
  }
  if(e.target.closest("[data-tpopen]")){ tpHub(); return; }
  if(e.target.closest("[data-tpstudio]")){ tpStudio(); return; }
  const t = e.target.closest("[data-tpl]");
  if(t){
    const T = TEMPLATES.find(x => x.k === t.dataset.tpl);
    if(T){ Object.assign(st, TEMPLATE_BASE, T.set); st.el = {}; st.template = T.k; styleChanged(true, "[data-tpl=\"" + T.k + "\"]"); toast("הסגנון «" + T.name + "» הוחל", "ok"); }
    return;
  }
  const p = e.target.closest("[data-k]");
  if(p){
    const k = p.dataset.k;
    let v = p.dataset.v;
    if(["lineHeight","columns","noteCols"].includes(k)) v = Number(v);
    if(k === "pageSize"){
      if(v === "custom"){ const d = pageDims(st); st.pageSize = "custom"; st.pageW = d.W; st.pageH = d.H; }
      else { const ps = PAGE_SIZES.find(x => x.k === v); st.pageSize = v; if(ps){ st.pageW = ps.w; st.pageH = ps.h; } }
    }else st[k] = v;
    if(k === "paraJoin" && v === "pasuk") applyPasukMode(st);
    // Abba (11-01): "חלון" like in עושה חיל means in EVERY paragraph, not only after a heading
    if(k === "opener" && (v === "letter" || v === "window")) st.openerEvery = true;
    if(PARA_KEYS.includes(k)) needParas();
    reportChange(choiceName(p), k);
    styleChanged(true, "[data-k=\"" + k + "\"][data-v=\"" + p.dataset.v + "\"]");
    return;
  }
  const sb = e.target.closest("[data-step]");
  if(sb){
    const k = sb.dataset.step;
    const v = Math.round((Number(st[k]) + Number(sb.dataset.d)) * 10) / 10;
    st[k] = Math.max(Number(sb.dataset.min), Math.min(Number(sb.dataset.max), v));
    styleChanged(true, "[data-step=\"" + k + "\"][data-d=\"" + sb.dataset.d + "\"]");
  }
}
function onDesignChange(e){
  const t = e.target;
  if(t.dataset.sel){ st[t.dataset.sel] = t.value; styleChanged(false); return; }
  if(t.dataset.ck === "bodyDibur" && st.diburWhere) st.diburWhere = t.checked ? (st.diburWhere !== "none" ? st.diburWhere : "numbered") : "none";
  if(t.dataset.ck){ st[t.dataset.ck] = t.checked; reportChange(chkName(t) + (t.checked ? " — פועל" : " — כבוי"), t.dataset.ck); styleChanged(false); return; }
  if(t.dataset.num){ st[t.dataset.num] = Math.max(Number(t.min), Math.min(Number(t.max), Number(t.value) || 0)); styleChanged(false); }
}

/* ----------------------------------------------------------- details tab */
function renderDetails(){
  const P = $("bkPanelDetails");
  if(!book) return;
  const f = (k, label, ph, rows) => rows
    ? `<label class="bk-field">${label}<textarea class="bk-input" rows="${rows}" data-d="${k}" placeholder="${esc(ph)}">${esc(book[k])}</textarea></label>`
    : `<label class="bk-field">${label}<input class="bk-input" data-d="${k}" value="${esc(book[k])}" placeholder="${esc(ph)}"/></label>`;
  P.innerHTML = `
${helpBox("details")}
<div class="bk-sub">
  ${f("title", "שם הספר", "למשל: אמרי שפר")}
  ${f("subtitle", "תת־כותרת (לא חובה)", "למשל: חידושים וביאורים על מסכת מכות", 2)}
  ${f("masechet", "שם המסכת — מודפס ליד הדף בראש העמוד (לא חובה)", "למשל: מכות")}
  ${f("author", "שם המחבר", "למשל: חיברתי בעזרת השי\"ת\nפלוני בן פלוני", 3)}
  <div class="bk-two">${f("place", "מקום", "ירושלים")}${f("year", "שנה", "תשפ\"ז")}</div>
  ${f("dedication", "הקדשה (לא חובה)", "לעילוי נשמת…", 3)}
  ${f("copyright", "זכויות (בגב השער)", "כל הזכויות שמורות למחבר", 2)}
</div>`;
}
function onDetailsInput(e){
  const k = e.target.dataset.d;
  if(!k) return;
  book[k] = e.target.value;
  if(k === "title") renderTop();
  markDirty(); scheduleLayout();
}

/* ------------------------------------------------------------- viewer */
const STYLE_OF = [[".bk-t-q","quoteIn"],[".bk-t-p","pasuk"],[".bk-dib","dibur"],[".bk-num","num"],[".bk-open","opener"],[".bk-sideh","side"],[".bk-src","src"],
  [".bk-quote","quote"],[".bk-h1","h1"],[".bk-h2","h2"],[".bk-h3","h3"],[".bk-hdaf","daf"],[".bk-notes","notes"],[".bk-head","head"],
  [".bk-foot","pnum"],[".bk-p","body"]];
function hidePop(){ const p = $("bkPop"); if(p) p.remove(); }
function onViewerClick(e){
  const act = e.target.closest("[data-wel]");
  if(act){ welcomeAction(act.dataset.wel); return; }
  if(e.target.closest(".bk-pop")) return;
  const tl = e.target.closest("a.bk-tocl");
  if(tl){ e.preventDefault(); const tg = $("bkViewer").querySelector(tl.getAttribute("href").replace(/^#/, "#")); if(tg) tg.scrollIntoView({block:"center", behavior:"smooth"}); return; }
  if(!e.target.closest(".bk-page")) { hidePop(); return; }
  if(e.target.closest(".bk-tp,.bk-tpfree")){ hidePop(); tpHub(); return; }
  { const o = e.target.closest(".bk-ornsep[data-orn]"); if(o){ ornEditPop(e, o); return; } }
  let styleKey = "";
  for(const [sel, k] of STYLE_OF){ if(e.target.closest(sel)){ styleKey = k; break; } }
  const t = e.target.closest("[data-sec]");
  const pv = $("bkPreview"), r = pv.getBoundingClientRect();
  hidePop();
  const pop = h("div", {class:"bk-pop", id:"bkPop", role:"menu"});
  const z = parseFloat(pv.style.zoom) || 1;
  pop.style.top = Math.max(4, (e.clientY - r.top) / z + 8) + "px";
  pop.style.left = Math.max(4, Math.min(r.width / z - 270, (e.clientX - r.left) / z - 130)) + "px";
  const isPara = t && t.classList.contains("bk-p") && parseInt(t.dataset.ln || "-1", 10) >= 0;
  const sec = t ? book.sections.find(x => x.id === t.dataset.sec) : null;
  if(isPara && sec) LASTP = {sec: sec.id, ln: parseInt(t.dataset.ln, 10)};
  if(FMT && t && sec){ const T2 = fmtTarget(t, sec); if(T2){ fmtGive(sec, parseInt(t.dataset.ln || "-1", 10), T2); return; } }
  // Abba clicked "📝 ערוך את הטקסט" in this menu 24 times in two days: a click on the text now
  // opens it at that paragraph at once; the menu keeps only the other things
  if(t){ jumpToText(t); const ta = ROOT.querySelector(".bk-sec.open textarea"); if(ta) whereAmI(ta); }
  // v1.9.01 (Eli 11-03: "את החלון הזה שנפתח בכל לחיצה על המסך תמחק. רק שיהיה ניתן לראות היכן הסמן עומד")
  if(!(e && e.type === "contextmenu")){ if(t) markHere(t.dataset.sec, parseInt(t.dataset.ln || "-1", 10)); return; }
  const adj = sec && isPara ? Number((sec.adj || {})[t.dataset.ln]) || 0 : 0;
  const FT = fmtTarget(t, sec);
  // v1.8.97 (Eli 11-03: "חלון עם ערכת צבעים — מיותר ומבלבל"): the format bar waits behind one button
  pop.innerHTML = "<button type=\"button\" class=\"bk-popx\" data-pop=\"x\" title=\"סגור\" aria-label=\"סגור\">✕</button>"

    + (isPara ? (adj > -3 ? "<button type=\"button\" data-pop=\"tight\">➖ צמצם את הפסקה (לחסוך שורה)</button>" : "")
      + (adj < 3 ? "<button type=\"button\" data-pop=\"loose\">➕ הרחב את הפסקה (להוסיף שורה)</button>" : "")
      + (adj ? "<button type=\"button\" data-pop=\"reset\">↺ החזר לרגיל (" + (adj < 0 ? "צמצום " : "הרחבה ") + Math.abs(adj) + " מתוך 3)</button>" : "") : "")
    + (isPara ? "<button type=\"button\" data-pop=\"headhere\">➕ כותרת כאן</button>" : "")
    + (isPara ? breakButtons(sec, parseInt(t.dataset.ln, 10)) : "")
    + (isPara ? (() => { const L = parseInt(t.dataset.ln, 10), cur = (k) => (sec[k] || {})[L], al = cur("align"), K = cur("keep");
        return `<div class="bk-pophint">¶ הפסקה הזו:</div><div class="bk-popps">`
          + ["r", "j", "c", "l"].map(v => `<button type="button" class="bk-pill${al === v ? " on" : ""}" data-pop="al-${v}">${{r:"⇥ לימין", j:"☰ לשני הצדדים", c:"≡ במרכז", l:"⇤ לשמאל"}[v]}</button>`).join("")
          + `<button type="button" class="bk-pill" data-pop="spb+">↥ רווח לפני</button><button type="button" class="bk-pill" data-pop="spa+">↧ רווח אחרי</button>`
          + ((cur("space") || {}).b || (cur("space") || {}).a ? `<button type="button" class="bk-pill" data-pop="spb-">− רווח לפני</button><button type="button" class="bk-pill" data-pop="spa-">− רווח אחרי</button>` : "")
          + `<button type="button" class="bk-pill${K === "all" ? " on" : ""}" data-pop="keepall">▣ לא לחתוך</button><button type="button" class="bk-pill${K === "next" ? " on" : ""}" data-pop="keepnext">⛓ עם הבאה</button>`
          + `<button type="button" class="bk-pill${cur("noPnum") ? " on" : ""}" data-pop="nopnum">בלי מספר עמוד</button><button type="button" class="bk-pill" data-pop="blank">📄 עמוד ריק לפני</button>`
          + `<button type="button" class="bk-pill" data-pop="paint">🖌 העתק עיצוב</button></div>`; })() : "")
    + (isPara && parseInt(t.dataset.ln, 10) > 0 ? "<button type=\"button\" data-pop=\"splithere\">✂ מכאן קטע חדש</button>" : "")
    + (isPara ? "<div class=\"bk-pophint\">🎨 סגנון לפסקה הזו:</div><div class=\"bk-popps\">"
        + psList().map(P => `<button type="button" class="bk-pill${(sec.pst || {})[t.dataset.ln] === P.id ? " on" : ""}" data-pops="${esc(P.id)}">${esc(P.name)}</button>`).join("")
        + ((sec.pst || {})[t.dataset.ln] ? "<button type=\"button\" class=\"bk-pill\" data-pops=\"\">רגיל</button>" : "") + "</div>"
        + ((sec.pst || {})[t.dataset.ln] ? `<button type="button" data-pop="psall">↧ «${esc(psName(sec.pst[t.dataset.ln]))}» לכל הפסקאות של הקטע</button>
             <button type="button" data-pop="psedit">🎨 לשנות איך «${esc(psName(sec.pst[t.dataset.ln]))}» נראה — בכל הספר</button>` : "") : "")
    + (styleKey ? "<button type=\"button\" data-pop=\"style\">📚 לשנות את כל ה" + esc(elName(styleKey)) + " בספר (גם הקודמים ישתנו)</button>" : "")
    + (FT ? "<button type=\"button\" data-pop=\"fmtopen\">🎨 לעצב רק את זה (גופן, גודל, יישור…)</button><div class=\"bk-fmtslot\"></div>" : "");
  pv.appendChild(pop);
  // v1.8.94: the menu is long now — it always stays inside the visible part of the pages, scrolling inside itself
  {
    const vis = pv.getBoundingClientRect(), z2 = parseFloat(pv.style.zoom) || 1;
    const maxH = Math.max(220, (Math.min(window.innerHeight, vis.bottom) - Math.max(0, vis.top)) / z2 - 24);
    pop.style.maxHeight = maxH + "px"; pop.style.overflowY = "auto";
    const pr = pop.getBoundingClientRect(), bottom = Math.min(window.innerHeight, vis.bottom);
    if(pr.bottom > bottom - 8){
      const up = (pr.bottom - (bottom - 8)) / z2;
      pop.style.top = Math.max(pv.scrollTop / z2 + 4, parseFloat(pop.style.top) - up) + "px";
    }
  }
  // the format bar works in place: the menu stays open, its numbers follow
  const fmtRefresh = () => { const box = pop.querySelector(".bk-fmtb"); if(box && FT){ const nb = h("div", {}, fmtBar(FT)).firstElementChild; box.replaceWith(nb); } };
  pop.addEventListener("change", ev => { const s = ev.target.closest("[data-fx='font']"); if(s && FT){ fmtDo(FT, "font", s.value); fmtRefresh(); } });
  pop.addEventListener("click", ev => {
    if(ev.target.closest("[data-pop='fmtopen']") && FT){
      const slot = pop.querySelector(".bk-fmtslot"); ev.target.closest("[data-pop='fmtopen']").remove();
      if(slot){ slot.innerHTML = fmtBar(FT);
        // the menu grew: it moves up so all of it stays on the screen (it scrolls inside itself if still too tall)
        const z3 = parseFloat(pv.style.zoom) || 1, pr = pop.getBoundingClientRect(), lim = Math.min(window.innerHeight, pv.getBoundingClientRect().bottom) - 8;
        if(pr.bottom > lim) pop.style.top = Math.max(pv.scrollTop / z3 + 4, parseFloat(pop.style.top) - (pr.bottom - lim) / z3) + "px";
        slot.scrollIntoView({block:"nearest"}); } return;   // the ✕ stays put (sticky), so the bar may come into view
    }
    const fx = ev.target.closest("[data-fx]");
    if(fx && FT && fx.dataset.fx !== "font"){
      if(fx.dataset.fx === "all"){ fmtAll(FT); hidePop(); return; }
      if(fx.dataset.fx === "paint"){ hidePop(); fmtTake(sec, parseInt(t.dataset.ln || "-1", 10), FT); return; }
      fmtDo(FT, fx.dataset.fx, fx.dataset.v || ""); fmtRefresh(); return;
    }
    const ps = ev.target.closest("[data-pops]");
    if(ps && sec && isPara){
      hidePop();
      const id = ps.dataset.pops;
      sec.pst = Object.assign({}, sec.pst || {});
      if(id) sec.pst[t.dataset.ln] = id; else delete sec.pst[t.dataset.ln];
      if(!Object.keys(sec.pst).length) delete sec.pst;
      markDirty(); scheduleLayout(0);
      toast(id ? "✓ הפסקה בסגנון «" + psName(id) + "». לשנות איך הסגנון נראה: לחיצה עליה שוב ← «לשנות איך … נראה»" : "✓ הפסקה חזרה לרגיל", "ok");
      return;
    }
    if(ev.target.closest("[data-pop='x']")){ hidePop(); return; }
    const b = ev.target.closest("[data-pop]");
    if(!b) return;
    const a = b.dataset.pop;
    hidePop();
    if(a === "edit") jumpToText(t);
    else if(a === "style"){ stylesSel = styleKey; setTab("styles"); }
    else if(a === "psedit" && sec && isPara){ const id = sec.pst[t.dataset.ln]; stylesSel = id === "pasuk" || id === "quote" ? id : "ps_" + id; setTab("styles"); }
    else if(a === "splithere" && sec && isPara){ splitAtLine(sec, parseInt(t.dataset.ln, 10)); }
    else if(a === "headhere" && sec && isPara){ headingHere(sec, parseInt(t.dataset.ln, 10)); }
    else if(/^(al-[rjcl]|sp[ba][+-]|keepall|keepnext|nopnum|blank)$/.test(a) && sec && isPara){ paraDo(sec, parseInt(t.dataset.ln, 10), a); }
    else if(a === "paint" && sec){ fmtTake(sec, parseInt(t.dataset.ln || "-1", 10), fmtTarget(t, sec)); }
    else if(/^(pagehere|colhere|unbreak|secpage|unsecpage)$/.test(a) && sec && isPara){ breakAt(sec, parseInt(t.dataset.ln, 10), a); }
    else if(a === "psall" && sec && isPara){
      const id = sec.pst[t.dataset.ln];
      sec.pst = {"*": id}; markDirty(); scheduleLayout(0);
      toast("✓ כל הפסקאות של הקטע בסגנון «" + psName(id) + "»", "ok");
    }
    else if(sec && isPara){
      sec.adj = Object.assign({}, sec.adj || {});
      const cur = Number(sec.adj[t.dataset.ln]) || 0;
      const nv = a === "reset" ? 0 : Math.max(-3, Math.min(3, cur + (a === "tight" ? -1 : 1)));
      if(nv) sec.adj[t.dataset.ln] = nv; else delete sec.adj[t.dataset.ln];
      markDirty(); scheduleLayout(80);
      toast(a === "tight" ? "הפסקה צומצמה" : (a === "loose" ? "הפסקה הורחבה" : "חזר לרגיל"), "ok");
    }
  });
}
const KIND_NAME = {chapter:"פרק", siman:"סימן", text:"קטע", intro:"הקדמה", haskama:"הסכמה", part:"שער / חלק"};
// v1.8.95 (Eli 11-02: "שאבא יוכל להוסיף כותרות במקומות שירצה"): a heading where Abba clicked — big (a chapter),
// middle (a siman) or small (a sub-heading in the part). Big / middle open a new part there with that title; at the
// first paragraph of a part with no title, the part itself takes it. Small = a "#" line before the paragraph.
function headingHere(sec, ln, lvl0){
  const w1 = st.chapterWord || "פרק", w2 = st.simanWord || "סימן";
  const first = breakPoint(sec, ln) <= firstTextLine(sec);
  const D = modal(`<header><h3>➕ כותרת לפני הפסקה הזו</h3></header><div class="bk-dbody">
    <div class="bk-tpnote">«${esc(firstWords(String(sec.text || "").split("\n")[ln] || "", 7))}…»</div>
    <label class="bk-field">הכותרת<input class="bk-input" id="bkHdT" placeholder="למשל: בגדר המצוה"/></label>
    <div>גודל: <span class="bk-pills">
      <button type="button" class="bk-pill" data-hdl="1">גדולה — ${esc(w1)}</button>
      <button type="button" class="bk-pill on" data-hdl="2">בינונית — ${esc(w2)}</button>
      <button type="button" class="bk-pill" data-hdl="3">קטנה — כותרת משנה</button></span></div>
    <small class="bk-tpnote">גדולה ובינונית מתחילות קטע חדש (עם מספור, אם הוא פועל); קטנה נשארת בתוך הקטע.</small></div>
    <footer><button class="bk-btn bk-primary" type="button" id="bkOk">✓ להוסיף כותרת</button><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
  let lvl = lvl0 || 2;
  D.querySelectorAll("[data-hdl]").forEach(x => x.classList.toggle("on", Number(x.dataset.hdl) === lvl));
  D.querySelectorAll("[data-hdl]").forEach(b => b.addEventListener("click", () => { lvl = Number(b.dataset.hdl); D.querySelectorAll("[data-hdl]").forEach(x => x.classList.toggle("on", x === b)); }));
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  const inp = D.querySelector("#bkHdT"); setTimeout(() => inp.focus(), 50);
  const go = () => {
    const title = inp.value.trim().replace(/\s+/g, " ");
    if(!title){ toast("כתבו את הכותרת", "warn"); inp.focus(); return; }
    closeModal();
    if(lvl === 3){
      // a line of its own in the style «כותרת קטנה» — a heading in every book, whatever the book does with "#" lines
      if(!psList().some(x => x.id === "title2")) st.pstyles = psList().map(x => Object.assign({}, x)).concat([{id:"title2", name:"כותרת קטנה"}]);
      const lines = String(sec.text || "").split("\n"), at = breakPoint(sec, ln);
      lines.splice(at, 0, title); sec.text = lines.join("\n"); shiftLines(sec, at, 1);
      sec.pst = Object.assign({}, sec.pst || {}, {[at]: "title2"});
      syncOpenText(sec, ln + 1);
      markDirty(); renderContent(); scheduleLayout(0); toast("✓ נוספה כותרת קטנה: «" + title + "». לשנות איך כל הכותרות הקטנות נראות: לשונית סגנונות ← «כותרת קטנה»", "ok"); return;
    }
    const kind = lvl === 1 ? "chapter" : "siman";
    if(first && !String(sec.title || "").trim()){
      sec.kind = kind; sec.title = title;
      markDirty(); renderContent(); scheduleLayout(0); toast("✓ לקטע נוספה הכותרת «" + title + "»", "ok"); return;
    }
    const before = book.sections.length;
    if(first){
      // the part already has a title: the new heading opens a new part right before it
      const idx = book.sections.indexOf(sec);
      book.sections.splice(idx, 0, {id:uid("s"), kind, title, text:""});
    }else{
      splitAtLine(sec, breakPoint(sec, ln));
      const ns = book.sections[book.sections.indexOf(sec) + 1];
      if(book.sections.length > before && ns){ ns.kind = kind; ns.title = title; }
    }
    markDirty(); renderContent(); scheduleLayout(0);
    toast("✓ כאן מתחיל " + (lvl === 1 ? w1 : w2) + " חדש: «" + title + "»", "ok");
  };
  D.querySelector("#bkOk").addEventListener("click", go);
  inp.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); go(); } });
}
// what was clicked, as something that can carry its own look, and what "all of its kind" means for it
function fmtTarget(t, sec){
  if(!t || !sec) return null;
  const ln = parseInt(t.dataset.ln || "-1", 10);
  const hk = ["h1", "h2", "h3", "hdaf"].find(k => t.classList.contains("bk-" + k));
  if(hk){
    const k = hk === "hdaf" ? "daf" : hk;
    const name = {h1: "כותרות ה" + (st.chapterWord || "פרק"), h2: "כותרות ה" + (st.simanWord || "סימן"), h3: "כותרות המשנה", daf: "כותרות הדף"}[k];
    return ln >= 0 ? {sec, ln, store: "fmt", kind: k, name, sel: `.bk-${hk}[data-sec="${sec.id}"][data-ln="${ln}"]`}
                   : {sec, store: "hfmt", kind: k, name, sel: `.bk-${hk}[data-sec="${sec.id}"]`};
  }
  if(!t.classList.contains("bk-p") || ln < 0) return null;
  const id = (sec.pst || {})[ln] || (sec.pst || {})["*"];
  const psel = `.bk-p[data-sec="${sec.id}"][data-ln="${ln}"]`;
  if(t.classList.contains("bk-pasukline") || id === "pasuk") return {sec, ln, store: "fmt", kind: "pasuk", name: "שורות הפסוק", sel: psel};
  if(t.classList.contains("bk-quote") || id === "quote") return {sec, ln, store: "fmt", kind: "quote", name: "הציטוטים המוזחים", sel: psel};
  if(id && psList().some(x => x.id === id)) return {sec, ln, store: "fmt", kind: "ps_" + id, name: "הפסקאות בסגנון «" + psName(id) + "»", sel: psel};
  return {sec, ln, store: "fmt", kind: "body", name: "הפסקאות הרגילות", sel: psel};
}
function fmtGet(T){ return T.store === "hfmt" ? Object.assign({}, T.sec.hfmt || {}) : Object.assign({}, (T.sec.fmt || {})[T.ln] || {}); }
function fmtPut(T, F){
  for(const k of Object.keys(F)) if(F[k] === "" || F[k] == null || F[k] === 0 || F[k] === false) delete F[k];
  if(T.store === "hfmt"){ if(Object.keys(F).length) T.sec.hfmt = F; else delete T.sec.hfmt; }
  else { T.sec.fmt = Object.assign({}, T.sec.fmt || {}); if(Object.keys(F).length) T.sec.fmt[T.ln] = F; else delete T.sec.fmt[T.ln]; if(!Object.keys(T.sec.fmt).length) delete T.sec.fmt; }
  markDirty(); scheduleLayout(0);
}
// the look of the element now: its own, else the book's look for its kind (so +/− start from what is seen)
function fmtNow(T){
  const F = fmtGet(T), e = st.el || {};
  const base = T.kind === "body" ? {size:100, lh: Number(st.lineHeight) || 1.5} : T.kind.startsWith("ps_") ? psLook(T.kind.slice(3)) : (e[T.kind] || {});
  const N = Object.assign({size: Number(base.size) || 100, lh: Number(base.lh) || 0, indent: Number(base.indent) || 0, before: Number(base.before) || 0, after: Number(base.after) || 0, ls: Number(base.ls) || 0}, F);
  const el = T.sel && $("bkViewer") ? $("bkViewer").querySelector(T.sel) : null;
  if(el && el.parentElement){
    const c = getComputedStyle(el), pc = getComputedStyle(el.parentElement), fs = parseFloat(c.fontSize), pfs = parseFloat(pc.fontSize);
    if(!F.size && fs && pfs) N.size = Math.round(fs / pfs * 100);
    if(!F.lh && fs){ const lh = parseFloat(c.lineHeight); if(lh) N.lh = Math.round(lh / fs * 100) / 100; }
  }
  return N;
}
function fmtBar(T){
  const F = fmtGet(T), N = fmtNow(T), on = (k, v) => F[k] === v ? " on" : "";
  return `<div class="bk-fmtb" data-fmtk="${esc(T.kind)}">
    <div class="bk-fmtb-row"><select class="bk-select bk-fmtb-font" data-fx="font" title="גופן">${fontOptions(F.font || "", "גופן: כמו בספר")}</select>
      <button type="button" class="bk-pill" data-fx="size-" title="קטן יותר">א−</button><span class="bk-fmtb-v" title="גודל">${Math.round(N.size)}%</span><button type="button" class="bk-pill" data-fx="size+" title="גדול יותר">א+</button>
      <button type="button" class="bk-pill${on("weight", "bold")}" data-fx="bold" title="מודגש"><b>B</b></button><button type="button" class="bk-pill${on("weight", "normal")}" data-fx="normal" title="לא מודגש">B̶</button>
      <button type="button" class="bk-pill${F.u ? " on" : ""}" data-fx="u" title="קו מתחת"><u>U</u></button></div>
    <div class="bk-fmtb-row">${[["", "שחור", "#000"], ["gray", "אפור", "#555"], ["blue", "כחול", "#173f8a"], ["red", "אדום", "#a3121a"], ["brown", "חום", "#6b3e12"]].map(([v, n, c]) => `<button type="button" class="bk-pill bk-fmtb-col${(F.color || "") === v ? " on" : ""}" data-fx="color" data-v="${v}" title="צבע: ${n}"><i style="background:${c}"></i></button>`).join("")}
      ${[["r", "⇥", "לימין"], ["j", "☰", "לשני הצדדים"], ["c", "≡", "במרכז"], ["l", "⇤", "לשמאל"]].map(([v, ic, n]) => `<button type="button" class="bk-pill${on("align", v)}" data-fx="align" data-v="${v}" title="יישור ${n}">${ic}</button>`).join("")}</div>
    <div class="bk-fmtb-row">
      <span class="bk-fmtb-l">רווח לפני</span><button type="button" class="bk-pill" data-fx="before-">−</button><button type="button" class="bk-pill" data-fx="before+">+</button>
      <span class="bk-fmtb-l">אחרי</span><button type="button" class="bk-pill" data-fx="after-">−</button><button type="button" class="bk-pill" data-fx="after+">+</button>
      <span class="bk-fmtb-l">הזחה</span><button type="button" class="bk-pill" data-fx="indent-">−</button><button type="button" class="bk-pill" data-fx="indent+">+</button></div>
    <div class="bk-fmtb-row">
      <span class="bk-fmtb-l">בין השורות</span><button type="button" class="bk-pill" data-fx="lh-">−</button><button type="button" class="bk-pill" data-fx="lh+">+</button>
      <span class="bk-fmtb-l">בין האותיות</span><button type="button" class="bk-pill" data-fx="ls-">−</button><button type="button" class="bk-pill" data-fx="ls+">+</button>
      ${Object.keys(F).length ? `<button type="button" class="bk-pill" data-fx="clear" title="להחזיר את הדבר הזה למראה של הספר">↺ לנקות</button>` : ""}
      <button type="button" class="bk-pill" data-fx="paint" title="להעתיק את העיצוב של הדבר הזה, וללחוץ על דבר אחר כדי להדביק">🖌 העתק עיצוב</button></div>
    ${Object.keys(F).length ? `<button type="button" class="bk-btn bk-primary bk-fmtb-all" data-fx="all">✓ שכל ${esc(T.name)} בספר ייראו כך</button>` : `<div class="bk-fmtb-hint">משנים כאן — רק הדבר הזה משתנה. אחר כך אפשר: «שכל ${esc(T.name)} בספר ייראו כך».</div>`}
  </div>`;
}
function fmtDo(T, fx, v){
  const F = fmtGet(T), N = fmtNow(T), step = (k, d, lo, hi, dec) => { F[k] = Math.round(Math.max(lo, Math.min(hi, (Number(N[k]) || 0) + d)) * dec) / dec; };
  if(fx === "font") F.font = v;
  else if(fx === "size+") step("size", 10, 50, 300, 1);
  else if(fx === "size-") step("size", -10, 50, 300, 1);
  else if(fx === "bold") F.weight = F.weight === "bold" ? "" : "bold";
  else if(fx === "normal") F.weight = F.weight === "normal" ? "" : "normal";
  else if(fx === "u") F.u = !F.u;
  else if(fx === "color") F.color = v;
  else if(fx === "align") F.align = F.align === v ? "" : v;
  else if(/^(before|after)[+-]$/.test(fx)) step(fx.slice(0, -1), fx.endsWith("+") ? 0.5 : -0.5, 0, 4, 10);
  else if(/^indent[+-]$/.test(fx)) step("indent", fx.endsWith("+") ? 1 : -1, 0, 8, 10);
  else if(/^lh[+-]$/.test(fx)){ if(!N.lh) N.lh = Number(st.lineHeight) || 1.5; step("lh", fx.endsWith("+") ? 0.1 : -0.1, 0.9, 3, 100); }
  else if(/^ls[+-]$/.test(fx)) step("ls", fx.endsWith("+") ? 0.02 : -0.02, -0.06, 0.4, 100);
  else if(fx === "clear"){ fmtPut(T, {}); return; }
  fmtPut(T, F);
}
// "שכל ה... בספר ייראו כך": the element's own look becomes the book's look for its kind, and its own is cleared
function fmtAll(T){
  const F = fmtGet(T); if(!Object.keys(F).length) return;
  st.el = Object.assign({}, st.el || {});
  const put = (k, keys) => { const cur = Object.assign({}, st.el[k] || {}); for(const x of keys) if(F[x] != null && F[x] !== "") cur[x] = F[x]; st.el[k] = cur; };
  const ALL = ["font", "size", "weight", "color", "align", "indent", "lh", "ls", "u", "before", "after"];
  const AL = {r:"right", c:"center", l:"left", j:""};
  if(T.kind === "body"){
    if(F.font) st.bodyFont = F.font;
    if(F.size) st.bodySize = Math.round((Number(st.bodySize) || 12) * F.size / 100 * 2) / 2;
    if(F.lh) st.lineHeight = F.lh;
    const B = Object.assign({}, st.el.body || {});
    if(F.align) B.align = AL[F.align]; if(F.ls) B.ls = F.ls; if(F.after) B.gap = F.after;
    st.el.body = B;
    // what the body style cannot hold as a whole-book setting goes to every plain paragraph through the «רגיל» look
    if(F.weight || F.color || F.u || F.indent || F.before){ const R = Object.assign({}, st.el.bodyx || {}); for(const x of ["weight", "color", "u", "indent", "before"]) if(F[x]) R[x] = F[x]; st.el.bodyx = R; }
  }else if(T.kind === "pasuk" || T.kind === "quote"){
    const k = T.kind; const cur = Object.assign({}, st.el[k] || {});
    for(const x of ["font", "size", "weight", "color", "ls", "u"]) if(F[x] != null && F[x] !== "") cur[x] = F[x];
    if(k === "quote"){ if(F.align) cur.align = AL[F.align] || ""; if(F.indent) cur.indent = F.indent; }
    st.el[k] = cur;
  }else if(T.kind.startsWith("ps_")){
    const cur = Object.assign({}, st.el[T.kind] || {});
    for(const x of ALL) if(F[x] != null && F[x] !== "") cur[x] = x === "align" ? ({r:"right", c:"center", l:"left", j:"justify"}[F[x]] || "") : F[x];
    st.el[T.kind] = cur;
  }else{
    const cur = Object.assign({}, st.el[T.kind] || {});
    for(const x of ["font", "size", "weight", "ls", "before", "after", "color", "u"]) if(F[x] != null && F[x] !== "") cur[x] = F[x];
    if(F.align) cur.align = {r:"right", c:"center", l:"left", j:"justify"}[F.align];
    st.el[T.kind] = cur;
  }
  fmtPut(T, {});
  toast("✓ מעכשיו כל " + T.name + " בספר נראים כך. לשנות שוב: לחיצה על אחד מהם, או לשונית 🖋 סגנונות", "ok");
}
// v1.8.94: one per-line choice for a paragraph (alignment, spacing, keep, no page number): set, step or clear
function lineSet(sec, ln, key, val){
  sec[key] = Object.assign({}, sec[key] || {});
  if(val === null || val === undefined || val === "" || (typeof val === "object" && !val.b && !val.a)) delete sec[key][ln]; else sec[key][ln] = val;
  if(!Object.keys(sec[key]).length) delete sec[key];
  markDirty(); scheduleLayout(0);
}
const AL_NAME = {r:"לימין", l:"לשמאל", j:"לשני הצדדים", c:"במרכז"};
function paraDo(sec, ln, a){
  const cur = (k) => (sec[k] || {})[ln];
  if(/^al-/.test(a)){ const v = a.slice(3); lineSet(sec, ln, "align", cur("align") === v ? null : v); toast(cur("align") ? "✓ הפסקה מיושרת " + AL_NAME[v] : "✓ הפסקה חזרה ליישור של הספר", "ok"); return; }
  if(/^sp[ba][+-]$/.test(a)){
    const S = Object.assign({b:0, a:0}, cur("space") || {}), k = a[2], d = a[3] === "+" ? 1 : -1;
    S[k] = Math.max(0, Math.min(4, (S[k] || 0) + d)); lineSet(sec, ln, "space", S);
    toast("✓ רווח " + (k === "b" ? "לפני" : "אחרי") + " הפסקה: " + (S[k] ? S[k] / 2 + " שורה" : "רגיל"), "ok"); return;
  }
  if(a === "keepall" || a === "keepnext"){ const v = a === "keepall" ? "all" : "next"; lineSet(sec, ln, "keep", cur("keep") === v ? null : v);
    toast(cur("keep") ? (v === "all" ? "✓ הפסקה לא תיחתך בין עמודים" : "✓ הפסקה תישאר באותו עמוד עם הפסקה שאחריה") : "✓ הפסקה — כרגיל בין עמודים", "ok"); return; }
  if(a === "nopnum"){ lineSet(sec, ln, "noPnum", cur("noPnum") ? null : 1); toast(cur("noPnum") ? "✓ בעמוד של הפסקה הזו לא יודפס מספר עמוד" : "✓ מספר העמוד חזר", "ok"); return; }
  if(a === "blank"){
    const lines = String(sec.text || "").split("\n"), at = breakPoint(sec, ln);
    let i = at - 1; while(i >= 0 && !lines[i].trim()) i--;
    if(i >= 0 && lines[i].trim() === "~~~0"){ lines.splice(i, 1); sec.text = lines.join("\n"); shiftLines(sec, i + 1, -1); syncOpenText(sec, ln - 1); markDirty(); scheduleLayout(0); toast("✓ העמוד הריק בוטל", "ok"); return; }
    lines.splice(at, 0, "~~~0"); sec.text = lines.join("\n"); shiftLines(sec, at, 1); syncOpenText(sec, ln + 1);
    markDirty(); scheduleLayout(0); toast("✓ לפני הפסקה הזו — עמוד ריק (לחיצה נוספת מבטלת)", "ok"); return;
  }
}
// v1.8.94: a picture in the book — made small enough for the book file (longest side 1600px), its proportions kept
// so the page knows its height before it is drawn; the text gets one line "@@תמונה <id> <width%> <caption>"
function insertAfterPara(line){
  const P = ribPara();
  if(P){
    const lines = String(P.sec.text || "").split("\n");
    const paras = paraLines(P.sec.text, st).filter(x => x[0].trim());
    const nx = paras.find(x => x[1] > P.ln);
    const at = nx ? nx[1] : lines.length;
    lines.splice(at, 0, line); P.sec.text = lines.join("\n"); shiftLines(P.sec, at, 1); syncOpenText(P.sec, at);
    return P.sec;
  }
  const sec = book.sections[book.sections.length - 1];
  sec.text = (String(sec.text || "").replace(/\s+$/, "") + "\n" + line).replace(/^\n/, ""); syncOpenText(sec);
  return sec;
}
function pictureDialog(){
  const inp = h("input", {type:"file", accept:"image/*"}); inp.style.display = "none"; document.body.appendChild(inp);
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0]; inp.remove(); if(!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
        const W = Math.max(1, Math.round(im.naturalWidth * k)), H = Math.max(1, Math.round(im.naturalHeight * k));
        const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, W, H); cx.drawImage(im, 0, 0, W, H);
        const src = cv.toDataURL("image/jpeg", 0.86);
        const D = modal(`<header><h3>🖼 תמונה בספר</h3></header><div class="bk-dbody">
          <div style="text-align:center"><img src="${src}" style="max-width:100%;max-height:220px;border:1px solid #ccc"/></div>
          <label class="bk-field">כיתוב מתחת לתמונה (אפשר להשאיר ריק)<input class="bk-input" id="bkPicCap"/></label>
          <div>רוחב: <span class="bk-pills">${[30, 50, 80, 100].map(w => `<button type="button" class="bk-pill${w === 80 ? " on" : ""}" data-picw="${w}">${w === 100 ? "כל הרוחב" : w + "%"}</button>`).join("")}</span></div></div>
          <footer><button class="bk-btn bk-primary" type="button" id="bkOk">✓ להכניס לספר</button><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
        let w = 80;
        D.querySelectorAll("[data-picw]").forEach(b => b.addEventListener("click", () => { w = Number(b.dataset.picw); D.querySelectorAll("[data-picw]").forEach(x => x.classList.toggle("on", x === b)); }));
        D.querySelector("#bkCancel").addEventListener("click", closeModal);
        D.querySelector("#bkOk").addEventListener("click", () => {
          const id = "i" + Date.now().toString(36);
          book.images = Object.assign({}, book.images || {}, {[id]: {src, w: W, h: H}});
          const cap = D.querySelector("#bkPicCap").value.trim().replace(/\s+/g, " ");
          closeModal();
          insertAfterPara("@@תמונה " + id + " " + w + (cap ? " " + cap : ""));
          markDirty(); scheduleLayout(0); toast("✓ התמונה נכנסה לספר. להזיז: בטקסט, השורה שמתחילה ב-@@תמונה", "ok");
        });
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(f);
  });
  inp.click();
}
function tableDialog(){
  const D = modal(`<header><h3>▦ טבלה</h3></header><div class="bk-dbody">
    <div class="bk-row"><label class="bk-field">עמודות<input class="bk-input" type="number" min="1" max="8" value="3" id="bkTbC" style="width:5em"/></label>
    <label class="bk-field">שורות<input class="bk-input" type="number" min="1" max="40" value="3" id="bkTbR" style="width:5em"/></label></div>
    <label class="bk-check"><input type="checkbox" id="bkTbH" checked/><span>שורה ראשונה — כותרות מודגשות</span></label>
    <div class="bk-hint">בטקסט כל שורה של הטבלה נראית כך: <b dir="rtl">| תא | תא | תא |</b> — כותבים בין הקווים.</div></div>
    <footer><button class="bk-btn bk-primary" type="button" id="bkOk">✓ להכניס טבלה</button><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelector("#bkOk").addEventListener("click", () => {
    const C = Math.max(1, Math.min(8, Number(D.querySelector("#bkTbC").value) || 3)), R = Math.max(1, Math.min(40, Number(D.querySelector("#bkTbR").value) || 3));
    const head = D.querySelector("#bkTbH").checked;
    const rows = [];
    for(let r = 0; r < R; r++) rows.push("| " + Array.from({length: C}, (_, c) => head && r === 0 ? "*כותרת " + (c + 1) + "*" : "תא").join(" | ") + " |");
    closeModal();
    const sec = insertAfterPara(rows.join("\n"));
    markDirty(); scheduleLayout(0); openSection(sec.id, true);
    toast("✓ נוספה טבלה. כותבים בתאים במקום «תא» — בחלון הטקסט", "ok");
  });
}
// "🖌 העתק עיצוב": the look of one paragraph (its style, alignment, spacing, keep) onto the next one clicked
let FMT = null;
function fmtTake(sec, ln, T){
  FMT = {look: T ? fmtGet(T) : Object.assign({}, (sec.fmt || {})[ln] || {})};
  if(ln != null && ln >= 0) for(const k of ["pst", "align", "space", "keep"]) if((sec[k] || {})[ln] != null) FMT[k] = JSON.parse(JSON.stringify(sec[k][ln]));
  if(ROOT) ROOT.classList.add("bk-painting");
  toast("🖌 העיצוב הועתק — לוחצים על הפסקה שצריכה לקבל אותו (Esc — ביטול)", "ok");
}
function fmtGive(sec, ln, T){
  if(ln != null && ln >= 0 && !(T && T.store === "hfmt")){
    for(const k of ["pst", "align", "space", "keep"]){ sec[k] = Object.assign({}, sec[k] || {}); if(FMT[k] != null) sec[k][ln] = JSON.parse(JSON.stringify(FMT[k])); else delete sec[k][ln]; if(!Object.keys(sec[k]).length) delete sec[k]; }
  }
  const look = Object.assign({}, FMT.look || {});
  if(T) fmtPut(T, look);
  else { sec.fmt = Object.assign({}, sec.fmt || {}); if(Object.keys(look).length) sec.fmt[ln] = look; else delete sec.fmt[ln]; if(!Object.keys(sec.fmt).length) delete sec.fmt; }
  FMT = null; if(ROOT) ROOT.classList.remove("bk-painting");
  markDirty(); scheduleLayout(0); toast("✓ העיצוב הודבק", "ok");
}
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && FMT){ FMT = null; if(ROOT) ROOT.classList.remove("bk-painting"); toast("העתקת העיצוב בוטלה", "ok"); } });
// v1.8.92: a new page / a new column from a click on the page (the ~~~ / ~~ marks Abba never had to learn).
// Before the first paragraph of a part: the whole part, heading and all, starts on a new page.
function breakPoint(sec, ln){
  const lines = String(sec.text || "").split("\n");
  let at = ln, i = ln - 1;
  while(i >= 0 && (!lines[i].trim() || /^#/.test(lines[i].trim()))){ if(/^#/.test(lines[i].trim())) at = i; i--; }
  return at;
}
function breakBefore(sec, ln){
  const lines = String(sec.text || "").split("\n");
  let i = breakPoint(sec, ln) - 1; while(i >= 0 && !lines[i].trim()) i--;
  return i >= 0 && /^~~~?$/.test(lines[i].trim()) ? {i, page: lines[i].trim() === "~~~"} : null;
}
function firstTextLine(sec){ const lines = String(sec.text || "").split("\n"); return lines.findIndex(x => x.trim()); }
function breakButtons(sec, ln){
  if(!(ln >= 0)) return "";
  const br = breakBefore(sec, ln), first = breakPoint(sec, ln) <= firstTextLine(sec);
  let h = "";
  if(br) h += `<button type="button" data-pop="unbreak">✕ לבטל את ה${br.page ? "עמוד" : "טור"} החדש לפני הפסקה הזו</button>`;
  else if(first) h += sec.newPage ? `<button type="button" data-pop="unsecpage">✕ הקטע לא יתחיל בעמוד חדש</button>`
                                  : `<button type="button" data-pop="secpage">📄 הקטע הזה מתחיל בעמוד חדש</button>`;
  else{
    h += `<button type="button" data-pop="pagehere">📄 מכאן עמוד חדש</button>`;
    if(Number(st.columns) === 2) h += `<button type="button" data-pop="colhere">▥ מכאן טור חדש</button>`;
  }
  return h;
}
// the text open for editing must show what a page action did to it (else typing there would undo it), with the
// cursor kept on the same paragraph
function syncOpenText(sec, line){
  const ta = ROOT.querySelector(".bk-sec[data-id=\"" + sec.id + "\"] textarea");
  if(!ta || ta.value === sec.text) return;
  ta.value = sec.text;
  if(line != null && line >= 0){ const lines = sec.text.split("\n"); const off = lines.slice(0, line).reduce((n, x) => n + x.length + 1, 0); try{ ta.setSelectionRange(off, off); }catch(e){} }
}
// a line put in / taken out: the per-line choices (style, tighter/looser) stay with their lines
function shiftLines(sec, from, by){
  for(const key of ["pst", "adj", "align", "space", "keep", "noPnum", "fmt"]){
    if(!sec[key]) continue;
    const o = {};
    for(const [k, v] of Object.entries(sec[key])){ if(k === "*" || Number(k) < from) o[k] = v; else o[Number(k) + by] = v; }
    sec[key] = o;
  }
}
function breakAt(sec, ln, a){
  if(a === "secpage" || a === "unsecpage"){
    if(a === "secpage") sec.newPage = true; else delete sec.newPage;
    markDirty(); scheduleLayout(0);
    toast(a === "secpage" ? "✓ הקטע הזה מתחיל עכשיו בעמוד חדש (עם הכותרת שלו)" : "✓ הקטע ממשיך באותו עמוד", "ok");
    return;
  }
  const lines = String(sec.text || "").split("\n");
  if(a === "unbreak"){
    const br = breakBefore(sec, ln); if(!br) return;
    lines.splice(br.i, 1); sec.text = lines.join("\n"); shiftLines(sec, br.i + 1, -1); syncOpenText(sec, ln - 1);
    markDirty(); scheduleLayout(0); toast("✓ המעבר בוטל — הטקסט ממשיך כרגיל", "ok"); return;
  }
  const at = breakPoint(sec, ln);
  lines.splice(at, 0, a === "pagehere" ? "~~~" : "~~"); sec.text = lines.join("\n"); shiftLines(sec, at, 1); syncOpenText(sec, ln + 1);
  markDirty(); scheduleLayout(0);
  toast(a === "pagehere" ? "✓ מכאן מתחיל עמוד חדש. לבטל: לחיצה על הפסקה ← «לבטל»" : "✓ מכאן מתחיל טור חדש. לבטל: לחיצה על הפסקה ← «לבטל»", "ok");
}
// v1.8.91 (Abba pressed "חתוך כאן" three times and got "שימו את הסמן"): a part is cut where a paragraph on the
// PAGE was clicked — no cursor to aim. Its per-line choices (style, tighter/looser) go with their lines.
function splitAtLine(sec, ln){
  const lines = String(sec.text || "").split("\n");
  if(!(ln > 0 && ln < lines.length)) return;
  const before = lines.slice(0, ln).join("\n").replace(/\s+$/, ""), after = lines.slice(ln).join("\n").replace(/^\s+/, "");
  if(!before.trim() || !after.trim()){ toast("כאן כבר מתחיל קטע", "warn"); return; }
  const move = (o) => { const a = {}, b = {}; for(const [k, v] of Object.entries(o || {})){ if(k === "*"){ a[k] = v; b[k] = v; } else if(Number(k) >= ln) b[Number(k) - ln] = v; else a[k] = v; } return [a, b]; };
  sec.text = before;
  const ns = {id:uid("s"), kind: sec.kind === "chapter" ? "siman" : sec.kind, title:"", text:after};
  for(const key of ["pst", "adj", "align", "space", "keep", "noPnum", "fmt"]){
    const [a1, b1] = move(sec[key]);
    if(Object.keys(a1).length) sec[key] = a1; else delete sec[key];
    if(Object.keys(b1).length) ns[key] = b1;
  }
  if(sec.look) ns.look = sec.look;
  const idx = book.sections.indexOf(sec);
  book.sections.splice(idx + 1, 0, ns);
  markDirty(); renderContent(); scheduleLayout(0);
  toast("✓ מכאן קטע חדש: «" + firstWords(after, 5) + "…». אפשר לתת לו כותרת בלשונית תוכן", "ok");
}
// v1.9.01: where the cursor stands, shown on the page (a thin blue bar at the paragraph's start + a light tint)
let HERE = null;
function markHere(sec, ln){
  HERE = sec ? {sec, ln} : null;
  const V = $("bkViewer"); if(!V) return;
  V.querySelectorAll(".bk-here").forEach(x => x.classList.remove("bk-here"));
  if(!HERE) return;
  const q = "[data-sec=\"" + HERE.sec + "\"]" + (HERE.ln >= 0 ? "[data-ln=\"" + HERE.ln + "\"]" : "");
  V.querySelectorAll(".bk-p" + q + ",.bk-h1" + q + ",.bk-h2" + q + ",.bk-h3" + q + ",.bk-ornsep" + q).forEach(x => x.classList.add("bk-here"));
}
function whereAmI(ta){
  const card = ta.closest(".bk-sec"), box = card && card.querySelector(".bk-where");
  const sec = card && book.sections.find(x => x.id === card.dataset.id);
  if(!box || !sec) return;
  const lineNo = ta.value.slice(0, ta.selectionStart).split("\n").length - 1;
  const raw = (ta.value.split("\n")[lineNo] || "").trim();
  // the paragraph this line belongs to (paragraphs may join several lines)
  const paras = paraLines(ta.value, st).filter(x => x[0].trim()).map(x => [x[0].replace(/[\u0004\u0005]/g, ""), x[1]]);
  let k = -1; for(let i = 0; i < paras.length; i++) if(paras[i][1] <= lineNo) k = i;
  const what = !raw ? "שורה ריקה" : /^#/.test(raw) ? "כותרת משנה" : /^=/.test(raw) ? "שורה במרכז" : /^>/.test(raw) ? "ציטוט מוזח"
    : /^(\*\s*){3,}$|^(✻\s*){3}$/.test(raw) ? "מפריד" : /^~~~$/.test(raw) ? "מעבר לעמוד חדש" : /^~~$/.test(raw) ? "מעבר לטור חדש"
    : /^\d{1,3}[.):]/.test(raw) ? "פסקה שמתחילה בספרה (מודגשת עד הנקודתיים)" : /^[א-ת]{1,3}[.)]\s/.test(raw) ? "פסקה ממוספרת" : "פסקה רגילה";
  let page = "";
  if(k >= 0){
    const ln = paras[k][1];
    const P = lastPages.find(x => x.el && x.el.querySelector("[data-sec=\"" + sec.id + "\"][data-ln=\"" + ln + "\"]"));
    if(P) page = ` <button type="button" class="bk-link bk-wherego" data-gopage="${P.n}">📄 עמוד ${esc(String(P.label || P.n))} בספר ↗</button>`;
  }
  // the page shows the same place (the cursor's paragraph); on the heading line = the part's heading
  if(k >= 0) markHere(sec.id, paras[k][1]); else markHere(sec.id, -1);
  const secName = (KIND_NAME[sec.kind] || "קטע") + (sec.title ? " «" + esc(sec.title) + "»" : "");
  box.innerHTML = `📍 ${esc(secName)} · ${k >= 0 ? "פסקה " + (k + 1) + " מתוך " + paras.length : "לפני הפסקה הראשונה"} · ${esc(what)}${page}`;
}
function jumpToText(t){
  const id = t.dataset.sec;
  const ln = parseInt(t.dataset.ln || "-1", 10);
  setTab("content");
  openSec = id;
  renderSections();
  const card = ROOT.querySelector(".bk-sec[data-id=\"" + id + "\"]");
  if(!card) return;
  card.scrollIntoView({block:"nearest"});
  const ta = card.querySelector("textarea");
  if(ta && ln >= 0){
    const lines = ta.value.split("\n");
    let off = 0;
    for(let i = 0; i < ln && i < lines.length; i++) off += lines[i].length + 1;
    ta.focus({preventScroll:true});
    // v1.9.01: the cursor goes to the START of the paragraph — nothing is selected (a selected paragraph was replaced
    // whole by the first key Abba typed; the storm scan lost ~800 characters that way). The page marks the place.
    ta.setSelectionRange(off, off);
    const ratio = ln / Math.max(1, lines.length);
    ta.scrollTop = Math.max(0, ratio * ta.scrollHeight - 60);
  }else if(ta){ ta.focus({preventScroll:true}); }
}
function welcomeCard(){
  return h("div", {class:"bk-welcome"}, `
  <h2>📖 ברוכים הבאים לעימוד ספר</h2>
  <p>כאן מסדרים ספר שלם להדפסה — עם הערות בתחתית העמוד, כותרות, מספרי עמודים ושער.
   מכניסים את הטקסט בחלון העריכה, והספר מתעמד לבד, עמוד אחרי עמוד.</p>
  <h3 class="bk-wel-h">1. איזה ספר זה?</h3>
  ${bookTypeCards(st && st.bookType, "data-weltype")}
  <h3 class="bk-wel-h">2. מכניסים את הטקסט</h3>
  <div class="bk-grid">
    <button class="bk-btn bk-soft" type="button" data-wel="paste">📋 הדבקת טקסט</button>
    <button class="bk-btn bk-soft" type="button" data-wel="word">📄 קובץ Word</button>
    <button class="bk-btn bk-soft" type="button" data-wel="archive">🖼 דפים שזוהו בתוכנה</button>
    <button class="bk-btn bk-soft" type="button" data-wel="write">✍ להתחיל לכתוב</button>
  </div>
  <p style="margin:14px 0 0"><button class="bk-btn bk-gold" type="button" data-wel="sample">✨ הצג ספר לדוגמה</button></p>`);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-weltype]");
  if(b){ setBookType(b.dataset.weltype).then(() => { const w = document.querySelector(".bk-welcome"); if(w) w.replaceWith(welcomeCard()); }); }
});
function welcomeAction(a){
  if(a === "paste") pasteDialog();
  else if(a === "word") pickFile(".docx");
  else if(a === "archive") archiveDialog();
  else if(a === "sample") loadSample();
  else if(a === "write"){ setTab("content"); openSection(book.sections[0].id, true); }
}

/* ------------------------------------------------------------- toolbars (v1.8.93) */
// Eli 11-02: "כל הלחצנים בסרגל כלים כמו בוורד; אבא יבחר איזה סרגל להציג ואיזה להסתיר; אייקונים מתאימים, ובריחוף
// כל כפתור אומר מה הוא עושה". Every button calls what the studio already does (no second way of doing a thing):
// text buttons act on the text open for editing (a click on a paragraph on the page opens it there, cursor and all),
// paragraph / page buttons act on that same paragraph.
let LASTP = null;
const IC = (d, extra) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${extra || ""}>${d}</svg>`;
const ICT = (ch, deco) => IC(`<text x="12" y="17" text-anchor="middle" font-size="15" font-weight="${deco === "b" ? 800 : 500}" font-family="Frank Ruhl Libre, David, serif" fill="currentColor" stroke="none"${deco === "s" ? ' letter-spacing="2"' : ""}>${ch}</text>` + (deco === "u" ? '<line x1="6" y1="20" x2="18" y2="20"/>' : ""));
const RIB = [
  {id:"text", name:"כתיבה", tip:"הדגשה, אותיות מיוחדות והערות — על הטקסט הפתוח לעריכה", btns:[
    ["bold", ICT("א", "b"), "הדגשה", "מסמנים מילים בטקסט ולוחצים: הן יודפסו מודגשות (Ctrl+B)"],
    ["u", ICT("א", "u"), "קו מתחת", "המילים שסימנתם יודפסו עם קו מתחתיהן"],
    ["rashi", ICT("רש"), "אותיות רש״י", "המילים שסימנתם יודפסו באותיות רש״י"],
    ["square", ICT("מר"), "אותיות מרובעות", "המילים שסימנתם יודפסו באותיות מרובעות (כמו דיבור המתחיל בספרים הישנים)"],
    ["gray", IC('<circle cx="12" cy="12" r="7" fill="currentColor" opacity=".35" stroke="none"/><text x="12" y="16" text-anchor="middle" font-size="10" fill="currentColor" stroke="none">א</text>'), "אפור", "המילים שסימנתם יודפסו באפור (להערה צדדית)"],
    ["spaced", ICT("א ב", "s"), "מרווח", "המילים שסימנתם יודפסו באותיות מרווחות — הדגשה בלי עובי"],
    ["pasukq", IC('<path d="M6 7h4v5H7l-1 4M14 7h4v5h-3l-1 4"/>'), "ציטוט מפסוק", "המילים שסימנתם הן ציטוט מפסוק: יודפסו בסגנון «ציטוט מפסוק»"],
    ["quotein", IC('<path d="M5 8h5v4H7M14 8h5v4h-3"/><path d="M5 17h14"/>'), "ציטוט בתוך הקטע", "המילים שסימנתם הן ציטוט: יודפסו בסגנון «ציטוט בתוך הקטע»"],
    ["selfont", IC('<text x="12" y="17" text-anchor="middle" font-size="14" font-family="David, serif" fill="currentColor" stroke="none">אב</text><path d="M5 20h14"/>'), "גופן לסימון", "המילים שסימנתם יודפסו בגופן שתבחרו"],
    ["selsize", IC('<text x="9" y="17" text-anchor="middle" font-size="15" fill="currentColor" stroke="none">א</text><text x="17" y="17" text-anchor="middle" font-size="9" fill="currentColor" stroke="none">א</text>'), "גודל לסימון", "המילים שסימנתם יודפסו בגודל שתבחרו"],
    ["selcolor", IC('<text x="12" y="15" text-anchor="middle" font-size="13" fill="currentColor" stroke="none">א</text><path d="M5 20h14" stroke="#a3121a" stroke-width="3"/>'), "צבע לסימון", "המילים שסימנתם יודפסו בצבע שתבחרו"],
    ["selclear", IC('<text x="10" y="16" text-anchor="middle" font-size="13" fill="currentColor" stroke="none">א</text><path d="M14 8l6 6M20 8l-6 6"/>'), "לנקות עיצוב", "מוריד מהמילים שסימנתם כל הדגשה, גופן, גודל וצבע"],
    ["big", IC('<text x="12" y="18" text-anchor="middle" font-size="19" font-weight="700" fill="currentColor" stroke="none">א</text><path d="M19 4v5M16.5 6.5h5"/>'), "אותיות גדולות", "המילים שסימנתם יודפסו גדולות יותר"],
    ["small", IC('<text x="11" y="17" text-anchor="middle" font-size="11" fill="currentColor" stroke="none">א</text><path d="M16.5 6.5h5"/>'), "אותיות קטנות", "המילים שסימנתם יודפסו קטנות יותר"],
    ["note", IC('<path d="M5 5h14v10H9l-4 4z"/><text x="12" y="13" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">1</text>'), "הערת שוליים", "במקום שבו עומד הסמן נוספת הערה, והיא מודפסת בתחתית העמוד"],
    ["src", IC('<path d="M5 5h14v10H9l-4 4z"/><text x="12" y="13" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">מ״מ</text>'), "מראה מקום בהערה", "הערה בסדרה השנייה (מראי מקומות) בתחתית העמוד"],
    ["remark", IC('<path d="M5 4h14v14H5z" stroke-dasharray="2 2"/><path d="M8 9h8M8 13h5"/>'), "הערה פרטית", "שורה לעצמכם שלא מודפסת בספר (מתחילה ב-%%)"],
  ]},
  {id:"para", name:"פסקה", tip:"מראה הפסקה שבה עומד הסמן, או הפסקה שלחצתם עליה בדף", btns:[
    ["headhere", IC('<path d="M5 5v14M13 5v14M5 12h8"/><path d="M18 9v6M15 12h6"/>'), "כותרת כאן", "כותרת לפני הפסקה הזו: גדולה (פרק), בינונית (סימן) או קטנה — כותבים אותה ובוחרים גודל"],
    ["style", IC('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/><path d="M17 15l3 3-3 3" opacity=".0"/>'), "סגנון לפסקה", "בחירת סגנון לפסקה: פסוק, פירוש, ציטוט, קטן… — ושינוי הסגנון משנה אותו בכל הספר"],
    ["al-r", IC('<path d="M5 6h14M9 10h10M5 14h14M9 18h10"/>'), "יישור לימין", "הפסקה הזו תיושר לימין (לחיצה נוספת — כמו בספר)"],
    ["al-j", IC('<path d="M5 6h14M5 10h14M5 14h14M9 18h10"/>'), "לשני הצדדים", "הפסקה הזו תיושר לשני הצדדים (לחיצה נוספת — כמו בספר)"],
    ["center", IC('<path d="M5 6h14M8 10h8M5 14h14M8 18h8"/>'), "שורה במרכז", "הפסקה תודפס במרכז השורה"],
    ["al-l", IC('<path d="M5 6h14M5 10h10M5 14h14M5 18h10"/>'), "יישור לשמאל", "הפסקה הזו תיושר לשמאל (לחיצה נוספת — כמו בספר)"],
    ["spb+", IC('<path d="M5 14h14M5 18h14"/><path d="M12 3v7M9 7l3 3 3-3"/>'), "רווח לפני", "עוד חצי שורה רווח לפני הפסקה (עד 2 שורות)"],
    ["spa+", IC('<path d="M5 6h14M5 10h14"/><path d="M12 13v7M9 17l3 3 3-3"/>'), "רווח אחרי", "עוד חצי שורה רווח אחרי הפסקה (עד 2 שורות)"],
    ["spc", IC('<path d="M5 8h14M5 16h14"/><path d="M8 4l8 16" opacity=".8"/>'), "בלי רווח נוסף", "הרווחים שהוספתם לפסקה הזו מתבטלים"],
    ["keepall", IC('<rect x="5" y="4" width="14" height="16" rx="1"/><path d="M8 9h8M8 12h8M8 15h5"/><path d="M3 12h2M19 12h2"/>'), "לא לחתוך", "הפסקה תודפס כולה באותו עמוד — לא תיחתך בין שני עמודים"],
    ["keepnext", IC('<rect x="5" y="3" width="14" height="7" rx="1"/><rect x="5" y="14" width="14" height="7" rx="1"/><path d="M12 10v4" stroke-width="3"/>'), "עם הבאה", "הפסקה תישאר באותו עמוד עם הפסקה שאחריה"],
    ["paint", IC('<path d="M5 4h11v5H5z"/><path d="M10 9v4h-1v7h3v-7h-1"/>'), "העתק עיצוב", "לוקחים את המראה של הפסקה הזו, ולוחצים על פסקה אחרת כדי לתת לה אותו"],
    ["indent", IC('<path d="M10 6h10M10 10h10M10 14h10M4 18h16"/><path d="M4 8l3 2-3 2"/>'), "הזחה", "הפסקה תודפס מוזחת מהצד (לחיצה נוספת — עוד הזחה)"],
    ["quote", IC('<path d="M8 6h12M8 10h12M8 14h12M8 18h12"/><path d="M4 5v14"/>'), "ציטוט מוזח", "הפסקה היא ציטוט: תודפס מוזחת ובסגנון «ציטוט כקטע נפרד»"],
    ["sub", IC('<path d="M5 6h14" stroke-width="3"/><path d="M5 12h14M5 16h14M5 20h10"/>'), "כותרת משנה", "השורה שבה עומד הסמן תהיה כותרת משנה מודגשת"],
    ["side", IC('<path d="M9 6h11M9 10h11M9 14h11M9 18h11"/><rect x="3" y="6" width="4" height="5" rx="1"/>'), "כותרת בשוליים", "כותרת קטנה שמודפסת בצד הדף, ליד הפסקה"],
    ["split", IC('<path d="M4 9h16M4 15h16" stroke-dasharray="2 2"/><circle cx="7" cy="5" r="2"/><circle cx="7" cy="19" r="2"/><path d="M8.5 6.5L18 15M8.5 17.5L18 9"/>'), "מכאן קטע חדש", "הקטע מתחלק לשניים: מהפסקה הזו מתחיל קטע חדש, שאפשר לתת לו כותרת ומראה משלו"],
  ]},
  {id:"page", name:"עמוד", tip:"איפה מתחיל עמוד חדש, טור חדש או קטע בעמוד חדש", btns:[
    ["pagehere", IC('<rect x="5" y="3" width="14" height="7" rx="1"/><rect x="5" y="14" width="14" height="7" rx="1"/><path d="M3 12h18" stroke-dasharray="2 2"/>'), "מכאן עמוד חדש", "הפסקה תתחיל בראש העמוד הבא (לחיצה נוספת — מבטלת)"],
    ["colhere", IC('<rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/><path d="M15 8h4M15 11h4"/>'), "מכאן טור חדש", "הפסקה תתחיל בראש הטור הבא (בספר עם שני טורים)"],
    ["secpage", IC('<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 7h8" stroke-width="3"/><path d="M8 11h8M8 14h8M8 17h5"/>'), "הקטע מתחיל בעמוד חדש", "כל הקטע של הפסקה הזו, עם הכותרת שלו, יתחיל בעמוד חדש (לחיצה נוספת — מבטלת)"],
    ["sep", IC('<path d="M4 12h3M10.5 12h3M17 12h3" stroke-width="3"/>'), "מפריד", "שורת מפריד (✻ ✻ ✻) במקום שבו עומד הסמן"],
    ["orns", IC('<path d="M3 13c3-5 6-5 9-1c3-4 6-4 9 1"/><circle cx="12" cy="12" r="1.6"/>'), "עיטורים", "מגירת עיטורים מצוירים להפרדה בין פסקאות"],
    ["blank", IC('<rect x="6" y="3" width="12" height="18" rx="1" stroke-dasharray="3 2"/>'), "עמוד ריק", "עמוד ריק לגמרי לפני הפסקה הזו (לחיצה נוספת — מבטלת)"],
    ["nopnum", IC('<rect x="5" y="3" width="14" height="18" rx="1"/><text x="12" y="18" text-anchor="middle" font-size="6" fill="currentColor" stroke="none">12</text><path d="M7 21l10-6"/>'), "בלי מספר עמוד", "בעמוד של הפסקה הזו לא יודפס מספר עמוד"],
  ]},
  {id:"insert", name:"הוספה", tip:"פרקים, סימנים, יבוא טקסט ושער", btns:[
    ["add-chapter", IC('<path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="2" opacity=".35"/>'), "פרק חדש", "מוסיף קטע חדש עם כותרת גדולה (פרק / פרשה / דף — לפי הספר)"],
    ["add-siman", IC('<path d="M12 7v10M7 12h10"/>'), "סימן חדש", "מוסיף קטע חדש עם כותרת קטנה (סימן / נושא)"],
    ["import", IC('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/>'), "יבוא טקסט", "הדבקת טקסט, קובץ Word או דפים שזוהו בתוכנה"],
    ["pic", IC('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 17l5-4 4 3 3-2 6 4"/>'), "תמונה", "ציור, צילום או שרטוט בתוך הספר, עם כיתוב"],
    ["table", IC('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M3 15h18M9 5v14M15 5v14"/>'), "טבלה", "טבלה בתוך הספר"],
    ["tp", IC('<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 7h8M9 10h6"/><circle cx="12" cy="15" r="2"/>'), "שער הספר", "עמוד השער: שם הספר, המחבר, עיטורים"],
  ]},
  {id:"check", name:"בדיקות", tip:"חיפוש, איות, סוגריים ומראי מקומות", btns:[
    ["find", IC('<circle cx="10" cy="10" r="5"/><path d="M14 14l6 6"/>'), "חיפוש בספר", "חיפוש מילה בכל הספר (Ctrl+F)"],
    ["replace", IC('<circle cx="9" cy="9" r="4"/><path d="M12 12l3 3"/><path d="M14 19h6M17 16l3 3-3 3"/>'), "חיפוש והחלפה", "החלפת מילה בכל הספר (Ctrl+H)"],
    ["spell", IC('<text x="9" y="13" text-anchor="middle" font-size="10" fill="currentColor" stroke="none">אב</text><path d="M13 17l3 3 5-6"/>'), "בדיקת איות", "מילים שאולי כתובות בטעות"],
    ["brackets", IC('<path d="M8 4c-3 3-3 13 0 16M16 4c3 3 3 13 0 16"/>'), "בדיקת סוגריים", "סוגריים שנפתחו ולא נסגרו"],
    ["sources", IC('<path d="M5 4h10l4 4v12H5z"/><path d="M8 11h8M8 15h6"/>'), "בדיקת מראי מקומות", "מראי מקומות שאולי כתובים לא נכון"],
  ]},
  {id:"view", name:"תצוגה וקובץ", tip:"ביטול, הגדלה, PDF ו-Word", btns:[
    ["undo", IC('<path d="M9 7H4v5"/><path d="M4 12c3-5 13-6 16 2"/>'), "בטל", "ביטול הפעולה האחרונה (Ctrl+Z)"],
    ["redo", IC('<path d="M15 7h5v5"/><path d="M20 12c-3-5-13-6-16 2"/>'), "החזר", "החזרת מה שבוטל (Ctrl+Y)"],
    ["zoomout", IC('<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20M7 10h6"/>'), "הקטן", "הקטנת הדפים במסך (הספר עצמו לא משתנה)"],
    ["zoomin", IC('<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20M7 10h6M10 7v6"/>'), "הגדל", "הגדלת הדפים במסך (הספר עצמו לא משתנה)"],
    ["spread", IC('<rect x="3" y="5" width="8" height="14" rx="1"/><rect x="13" y="5" width="8" height="14" rx="1"/>'), "עמוד אחד / שני עמודים", "להציג כל עמוד לבד, או שני עמודים זה מול זה כמו בספר מודפס"],
    ["pdf", IC('<path d="M6 3h9l4 4v14H6z"/><text x="12.5" y="17" text-anchor="middle" font-size="6" font-weight="700" fill="currentColor" stroke="none">PDF</text>'), "PDF להדפסה", "הפקת קובץ PDF של כל הספר, מוכן לבית הדפוס (Ctrl+P)"],
    ["docx", IC('<path d="M6 3h9l4 4v14H6z"/><text x="12.5" y="17" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" stroke="none">W</text>'), "שמור כ-Word", "שמירת הספר כקובץ Word"],
    ["versions", IC('<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>'), "גרסאות קודמות", "לחזור לאיך שהספר היה לפני שעה, אתמול…"],
  ]},
];
const RIB_DEFAULT = ["text", "para", "page", "view"];
function ribShown(){
  try{ const v = JSON.parse(lsGet("bk_bars", "null")); if(Array.isArray(v)) return v; }catch(e){}
  return RIB_DEFAULT.slice();
}
function renderRibbon(){
  const R = $("bkRibbon"); if(!R) return;
  const shown = ribShown();
  const wordOf = (k) => k === "add-chapter" ? (st && st.chapterWord || "פרק") + " חדש" : k === "add-siman" ? (st && st.simanWord || "סימן") + " חדש" : "";
  R.innerHTML = `<div class="bk-rib-bars">${RIB.filter(B => shown.includes(B.id)).map(B => `<div class="bk-rib-bar" role="group" aria-label="${esc(B.name)}">
      <div class="bk-rib-btns">${B.btns.map(([k, ic, name, tip]) => `<button type="button" class="bk-rib-b" data-rib="${k}" aria-label="${esc(wordOf(k) || name)}" data-tipn="${esc(wordOf(k) || name)}" data-tipd="${esc(tip)}">${ic}<span>${esc(wordOf(k) || name)}</span></button>`).join("")}</div>
      <div class="bk-rib-name">${esc(B.name)}</div></div>`).join("")}</div>
    <div class="bk-rib-menu"><button type="button" class="bk-rib-b bk-rib-pick" data-ribpick="1" aria-haspopup="true" data-tipn="סרגלים" data-tipd="לבחור אילו סרגלי כלים יופיעו כאן">${IC('<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/>')}<span>סרגלים ▾</span></button></div>`;
}
function ribPickMenu(btn){
  const old = document.getElementById("bkRibPick"); if(old){ old.remove(); return; }
  const shown = ribShown();
  const m = h("div", {class:"bk-rib-pickmenu", id:"bkRibPick", role:"menu"});
  m.innerHTML = `<div class="bk-rib-pickh">אילו סרגלים להציג:</div>` + RIB.map(B => `<label class="bk-check"><input type="checkbox" data-ribbar="${B.id}"${shown.includes(B.id) ? " checked" : ""}/><span>${esc(B.name)}<small>${esc(B.tip)}</small></span></label>`).join("")
    + `<div class="bk-rib-pickrow"><button type="button" class="bk-btn bk-small" data-riball="1">הכל</button><button type="button" class="bk-btn bk-small" data-ribnone="1">בלי סרגלים</button><button type="button" class="bk-btn bk-small" data-ribdef="1">כמו בהתחלה</button></div>`;
  const r = btn.getBoundingClientRect(), rr = ROOT.getBoundingClientRect();
  m.style.top = (r.bottom - rr.top + 4) + "px"; m.style.left = Math.max(8, r.left - rr.left) + "px";
  ROOT.appendChild(m);
  const save = (list) => { lsSet("bk_bars", JSON.stringify(list)); renderRibbon(); };
  m.addEventListener("change", e => { const cb = e.target.closest("[data-ribbar]"); if(!cb) return;
    const list = RIB.map(B => B.id).filter(id => id === cb.dataset.ribbar ? cb.checked : ribShown().includes(id)); save(list); });
  m.addEventListener("click", e => {
    if(e.target.closest("[data-riball]")) save(RIB.map(B => B.id)); else if(e.target.closest("[data-ribnone]")) save([]); else if(e.target.closest("[data-ribdef]")) save(RIB_DEFAULT.slice()); else return;
    m.remove();
  });
}
// the paragraph a toolbar button works on: where the cursor stands in the open text, else the one clicked on the page
function ribTextarea(){
  let ta = ROOT.querySelector(".bk-sec.open textarea");
  if(!ta && LASTP){
    // the text Abba clicked on the page opens behind the scenes (the tab he is on stays); the cursor goes to it
    const sec = book.sections.find(x => x.id === LASTP.sec);
    if(sec){ openSec = sec.id; renderSections(); ta = ROOT.querySelector(".bk-sec.open textarea");
      if(ta){ const off = String(sec.text || "").split("\n").slice(0, LASTP.ln).reduce((n, x) => n + x.length + 1, 0); try{ ta.setSelectionRange(off, off); }catch(e){} } }
  }
  return ta;
}
function ribPara(){
  const ta = ribTextarea();
  if(ta){
    const card = ta.closest(".bk-sec"), sec = card && book.sections.find(x => x.id === card.dataset.id);
    if(sec){
      const lineNo = ta.value.slice(0, ta.selectionStart || 0).split("\n").length - 1;
      const paras = paraLines(ta.value, st).filter(x => x[0].trim());
      let ln = paras.length ? paras[0][1] : 0; for(const x of paras) if(x[1] <= lineNo) ln = x[1];
      return {sec, ln};
    }
  }
  if(LASTP){ const sec = book.sections.find(x => x.id === LASTP.sec); if(sec) return {sec, ln: LASTP.ln}; }
  return null;
}
function ribNeedText(){ toast("קודם לוחצים על המקום בספר: לחיצה על פסקה בדף פותחת אותה לעריכה, ואז לוחצים על הכפתור", "warn"); }
const RIB_TAG = {u:"קו", rashi:"רש", square:"מר", gray:"אפ", spaced:"רו", pasukq:"פס", quotein:"צט", big:"גד", small:"קט"};
function ribAct(k, btn){
  hidePop();
  const ta = ribTextarea();
  // --- the text that is open for editing
  if(k === "orns"){ ornDrawer(); return; }
  if(k === "bold" || RIB_TAG[k] || ["note", "src", "center", "indent", "quote", "sub", "side", "sep", "remark"].includes(k)){
    if(!ta){ ribNeedText(); return; }
    if(k === "bold") wrapSel(ta, "*", "*");
    else if(RIB_TAG[k]) wrapSel(ta, "<" + RIB_TAG[k] + ">", "</" + RIB_TAG[k] + ">");
    else if(k === "note" || k === "src") noteDialog(k === "src" ? "b" : "a", ta);
    else if(k === "center") prefixLine(ta, "= ");
    else if(k === "indent") prefixLine(ta, "» ");
    else if(k === "quote") prefixLine(ta, "> ");
    else if(k === "sub") subHeadingAt(ta);
    else if(k === "side") sideHeading(ta);
    else if(k === "sep") insertText(ta, "\n***\n");
    else if(k === "remark"){
      // v1.9.01 (storm scan): a private remark is a NEW line under the paragraph — it never turns the paragraph the
      // cursor stands in into a hidden remark (the paragraph vanished from the book)
      const v = ta.value, e = v.indexOf("\n", ta.selectionStart), at = e < 0 ? v.length : e;
      const lineStart = v.lastIndexOf("\n", ta.selectionStart - 1) + 1, line = v.slice(lineStart, at);
      if(!line.trim() || /^%%/.test(line.trim())) prefixLine(ta, "%% ");
      else { ta.focus(); ta.setRangeText("\n%% ", at, at, "end"); fireInput(ta); }
      toast("הערה פרטית: מה שתכתבו בשורה הזו לא יודפס בספר", "ok");
    }
    return;
  }
  if(/^(al-[rjl]|sp[ba]\+|spc|keepall|keepnext|nopnum|blank|paint)$/.test(k)){
    const P = ribPara(); if(!P){ ribNeedText(); return; }
    if(k === "paint") return fmtTake(P.sec, P.ln, null);
    if(k === "spc"){ lineSet(P.sec, P.ln, "space", null); toast("✓ הרווחים הנוספים של הפסקה בוטלו", "ok"); return; }
    return paraDo(P.sec, P.ln, k);
  }
  if(k === "selfont" || k === "selsize" || k === "selcolor" || k === "selclear"){
    if(!ta){ ribNeedText(); return; }
    if(ta.selectionStart === ta.selectionEnd){ toast("קודם מסמנים את המילים בטקסט (גוררים עליהן את העכבר), ואז בוחרים", "warn"); return; }
    if(k === "selclear"){
      const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
      const mid = v.slice(a, b).replace(ANY_TAG_G, "").replace(/\*/g, "");
      ta.setRangeText(mid, a, b, "select"); ta.dispatchEvent(new Event("input", {bubbles:true}));
      toast("✓ העיצוב הוסר מהמילים שסימנתם", "ok"); return;
    }
    const old = document.getElementById("bkRibSel"); if(old) old.remove();
    const m = h("div", {class:"bk-rib-pickmenu", id:"bkRibSel", role:"menu"});
    const sel = {a: ta.selectionStart, b: ta.selectionEnd};
    if(k === "selfont") m.innerHTML = `<div class="bk-rib-pickh">גופן למילים שסימנתם:</div><select class="bk-select" id="bkSelFont" size="10" style="width:100%">${fontOptions("")}</select>`;
    if(k === "selsize") m.innerHTML = `<div class="bk-rib-pickh">גודל למילים שסימנתם:</div><div class="bk-popps">${[60, 75, 85, 115, 130, 150, 180, 220].map(z => `<button type="button" class="bk-pill" data-selv="${z}" style="font-size:${Math.min(22, 14 * z / 100)}px">${z}%</button>`).join("")}</div>`;
    if(k === "selcolor") m.innerHTML = `<div class="bk-rib-pickh">צבע למילים שסימנתם:</div><div class="bk-popps">${[["gray", "אפור"], ["blue", "כחול"], ["red", "אדום"], ["brown", "חום"]].map(([v, n]) => `<button type="button" class="bk-pill" data-selv="${v}"><i style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${FMT_COLORS[v]};vertical-align:middle"></i> ${n}</button>`).join("")}</div>`;
    const r = btn.getBoundingClientRect(), rr = ROOT.getBoundingClientRect();
    m.style.top = (r.bottom - rr.top + 4) + "px"; m.style.left = Math.max(8, r.left - rr.left - 80) + "px";
    ROOT.appendChild(m);
    const tag = {selfont:"גופן", selsize:"גודל", selcolor:"צבע"}[k];
    const apply = (v) => {
      m.remove(); if(!v) return;
      ta.focus(); ta.setSelectionRange(sel.a, sel.b);
      wrapSel(ta, "<" + tag + "=" + v + ">", "</" + tag + ">");
      toast("✓ המילים שסימנתם יודפסו " + ({selfont:"בגופן שבחרתם", selsize:"בגודל " + v + "%", selcolor:"בצבע שבחרתם"}[k]), "ok");
    };
    m.addEventListener("click", e => { const b = e.target.closest("[data-selv]"); if(b) apply(b.dataset.selv); });
    const fs = m.querySelector("#bkSelFont"); if(fs) fs.addEventListener("change", () => apply(fs.value));
    return;
  }
  if(k === "pic") return pictureDialog();
  if(k === "table") return tableDialog();
  // --- the paragraph: where the cursor stands, or the one clicked on the page
  if(["style", "split", "pagehere", "colhere", "secpage", "headhere"].includes(k)){
    const P = ribPara(); if(!P){ ribNeedText(); return; }
    if(k === "headhere") return headingHere(P.sec, P.ln);
    if(k === "split") return splitAtLine(P.sec, P.ln);
    if(k === "secpage") return breakAt(P.sec, P.ln, P.sec.newPage ? "unsecpage" : "secpage");
    if(k === "pagehere" || k === "colhere"){
      const br = breakBefore(P.sec, P.ln);
      if(br && br.page === (k === "pagehere")) return breakAt(P.sec, P.ln, "unbreak");
      if(k === "colhere" && Number(st.columns) !== 2){ toast("טור חדש — רק בספר עם שני טורים (בלשונית עיצוב ← העמוד ← טורים)", "warn"); return; }
      if(P.ln <= firstTextLine(P.sec) && k === "pagehere") return breakAt(P.sec, P.ln, P.sec.newPage ? "unsecpage" : "secpage");
      return breakAt(P.sec, P.ln, k);
    }
    if(k === "style"){
      const old = document.getElementById("bkRibStyles"); if(old){ old.remove(); return; }
      const m = h("div", {class:"bk-rib-pickmenu", id:"bkRibStyles", role:"menu"});
      const cur = (P.sec.pst || {})[P.ln];
      m.innerHTML = `<div class="bk-rib-pickh">סגנון לפסקה «${esc(firstWords(String(P.sec.text || "").split("\n")[P.ln] || "", 4))}…»:</div><div class="bk-popps">`
        + psList().map(S => `<button type="button" class="bk-pill${cur === S.id ? " on" : ""}" data-ribps="${esc(S.id)}">${esc(S.name)}</button>`).join("")
        + (cur ? `<button type="button" class="bk-pill" data-ribps="">רגיל</button>` : "") + `</div>`;
      const r = btn.getBoundingClientRect(), rr = ROOT.getBoundingClientRect();
      m.style.top = (r.bottom - rr.top + 4) + "px"; m.style.left = Math.max(8, r.left - rr.left - 120) + "px";
      ROOT.appendChild(m);
      m.addEventListener("click", e => { const b = e.target.closest("[data-ribps]"); if(!b) return; m.remove();
        const id = b.dataset.ribps; P.sec.pst = Object.assign({}, P.sec.pst || {});
        if(id) P.sec.pst[P.ln] = id; else delete P.sec.pst[P.ln];
        if(!Object.keys(P.sec.pst).length) delete P.sec.pst;
        markDirty(); scheduleLayout(0); toast(id ? "✓ הפסקה בסגנון «" + psName(id) + "»" : "✓ הפסקה חזרה לרגיל", "ok"); });
      return;
    }
  }
  // --- the book
  const click = (id) => { const el = document.getElementById(id); if(el) el.click(); };
  if(k === "add-chapter" || k === "add-siman"){
    const P = ribPara();
    if(P && String(P.sec.text || "").trim()) return headingHere(P.sec, P.ln, k === "add-chapter" ? 1 : 2);
    setTab("content"); const b = ROOT.querySelector("#bkPanelContent [data-act=\"" + k + "\"]"); if(b) b.click(); return;
  }
  if(k === "import"){ if(typeof showImport === "function") showImport(); return; }
  if(k === "tp"){ tpHub(); return; }
  if(k === "find"){ const q = $("bkSearchQ"); if(q){ q.focus(); q.select(); } return; }
  if(k === "replace" || k === "spell" || k === "brackets" || k === "sources"){
    showTools(); if(k !== "replace"){ const d = document.querySelector("#bkDialog [data-tool=\"" + k + "\"]"); if(d) d.click(); }
    else { const d = document.querySelector("#bkDialog [data-tool=\"find\"]"); if(d) d.click(); }
    return;
  }
  if(k === "undo") return undo();
  if(k === "redo") return redo();
  if(k === "zoomin") return click("bkZoomIn");
  if(k === "zoomout") return click("bkZoomOut");
  if(k === "spread") return click("bkViewMenuBtn");
  if(k === "pdf") return click("bkPdfBtn");
  if(k === "docx") return click("bkDocxBtn");
  if(k === "versions") return click("bkVersionsBtn");
}
// hover: the button says what it does (a real tooltip, quick and big enough to read — not the browser's tiny one)
let RIB_TIP_T = null;
function ribTipShow(b){
  const tip = $("bkRibTip") || (() => { const x = h("div", {class:"bk-rib-tip", id:"bkRibTip", role:"tooltip"}); ROOT.appendChild(x); return x; })();
  tip.innerHTML = `<b>${esc(b.dataset.tipn || "")}</b>${b.dataset.tipd ? "<span>" + esc(b.dataset.tipd) + "</span>" : ""}`;
  const r = b.getBoundingClientRect(), rr = ROOT.getBoundingClientRect();
  tip.hidden = false; tip.style.top = (r.bottom - rr.top + 6) + "px";
  const w = tip.offsetWidth; tip.style.left = Math.max(6, Math.min(rr.width - w - 6, r.left - rr.left + r.width / 2 - w / 2)) + "px";
}
function ribTipHide(){ clearTimeout(RIB_TIP_T); const tip = $("bkRibTip"); if(tip) tip.hidden = true; }
function wireRibbon(){
  const R = $("bkRibbon"); if(!R) return;
  R.addEventListener("mousedown", e => { if(e.target.closest("[data-rib]")) e.preventDefault(); });   // keep the cursor / selection in the text
  R.addEventListener("click", e => {
    const pick = e.target.closest("[data-ribpick]"); if(pick){ ribTipHide(); ribPickMenu(pick); return; }
    const b = e.target.closest("[data-rib]"); if(!b) return;
    ribTipHide(); trail("click", {where: "סרגל כלים", name: b.dataset.tipn});
    ribAct(b.dataset.rib, b);
  });
  R.addEventListener("mouseover", e => { const b = e.target.closest("[data-tipn]"); if(!b) return; clearTimeout(RIB_TIP_T); RIB_TIP_T = setTimeout(() => ribTipShow(b), 250); });
  R.addEventListener("mouseout", e => { if(e.target.closest("[data-tipn]") && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("[data-tipn]") === e.target.closest("[data-tipn]"))) ribTipHide(); });
  R.addEventListener("focusin", e => { const b = e.target.closest("[data-tipn]"); if(b) ribTipShow(b); });
  R.addEventListener("focusout", ribTipHide);
  document.addEventListener("mousedown", e => { for(const id of ["bkRibPick", "bkRibStyles", "bkRibSel"]){ const m = document.getElementById(id); if(m && !m.contains(e.target) && !e.target.closest("[data-ribpick],[data-rib='style'],[data-rib^='sel']")) m.remove(); } });
}

/* ------------------------------------------------------------- styles tab */
// One global style per element: change it once, it changes in the whole book.
let stylesSel = "dibur";
const ELEMENTS = [
  ["body", "גוף הטקסט", "¶"], ["dibur", "דיבור המתחיל", "ד\"ה"], ["num", "מספר דיבור / סעיף", "א)"],
  ["opener", "מילת פתיח", "א"], ["end", "סיום קטע", "✻"], ["h1", "כותרת פרק / דף", "פרק"],
  ["h2", "כותרת סימן / נושא", "סימן"], ["h3", "כותרת משנה", "#"], ["daf", "הדף בגמרא", "דף"], ["pasuk", "ציטוט מפסוק", "״"], ["quoteIn", "ציטוט בתוך הקטע", "❝"], ["quote", "ציטוט כקטע נפרד", "▬"],
  ["src", "מראי מקומות בסוגריים", "( )"], ["notes", "הערות שוליים", "¹"], ["head", "כותרת עליונה", "⌃"],
  ["pnum", "מספר עמוד", "יב"], ["side", "כותרות בשוליים", "⇤"], ["cols", "טורים", "▥"],
];
function elName(k){ if(/^ps_/.test(k)) return "סגנון «" + psName(k.slice(3)) + "»"; const e = ELEMENTS.find(x => x[0] === k); return e ? e[1] : k; }
function getPath(path){
  if(path === "@lastline") return st.centerEvery ? "every" : (st.centerLastLine ? "section" : "none");
  if(path === "@dibwhere") return diburWhere(st);
  if(path === "@dibmode") return (st.diburUntil === "words") ? "words" : "marks";
  if(path === "@dibmarks") return diburMarkSet(st).join(",");
  let o = st;
  for(const k of path.split(".")){ if(o == null) return undefined; o = o[k]; }
  return o;
}
function setPath(path, v){
  // v1.8.85 (Eli 11-01: "בספר עושה חיל ההגדרות מעולות ואילו בספר חדש ההגדרות לא נשמעות לו"): measured on Abba's
  // new book — there "the dibur is a pasuk quote" was on, so the pasuk look silently beat every dibur setting he
  // chose (8 font changes, nothing moved). What he sets for an element now always wins: touching the dibur's own
  // look turns that link off (with a line saying so), touching the opening word's look gives it its own look.
  if(/^el\.dibur\./.test(path) && st.diburPasuk){
    st.diburPasuk = false;
    setTimeout(() => toast("הדיבור המתחיל קיבל מראה משלו (לא כמו הפסוק), כדי שמה שבחרת ייראה בדף", "ok"), 0);
  }
  if(path === "@lastline"){ st.centerEvery = v === "every"; st.centerLastLine = v === "section"; return; }
  if(path === "@dibwhere"){ st.diburWhere = v; return; }
  if(path === "@dibmode"){ st.diburUntil = v === "words" ? "words" : "marks"; return; }
  if(path === "@dibmarks"){ st.diburMarks = String(v || ""); if(st.diburUntil === "words") st.diburUntil = "marks"; return; }
  const parts = path.split(".");
  let o = st;
  for(let i = 0; i < parts.length - 1; i++){
    if(o[parts[i]] == null || typeof o[parts[i]] !== "object") o[parts[i]] = {};
    o = o[parts[i]];
  }
  const last = parts[parts.length - 1];
  if(v === "" || v == null) delete o[last]; else o[last] = v;
}
// a line in the styles tab that sends to the design tab for a whole-book choice (one home each)
const toDesign = (what) => `<div class="bk-hint bk-todesign">${what} — בלשונית <button type="button" class="bk-link" data-gotab="design">🎨 עיצוב</button></div>`;
const SC = {
  pills(path, opts, label, num){
    const cur = String(getPath(path) ?? "");
    return `<div class="bk-ctl"><span class="bk-ctl-l">${label}</span><div class="bk-pills">` + opts.map(([v, l]) =>
      `<button type="button" class="bk-pill${cur === String(v) ? " on" : ""}" data-sp="${path}" data-sv="${esc(v)}"${num ? " data-num=\"1\"" : ""}>${l}</button>`).join("") + "</div></div>";
  },
  multi(path, opts, label){
    // several may be on at once (v1.8.82: the marks that end a dibur)
    const cur = String(getPath(path) ?? "").split(",").filter(Boolean);
    return `<div class="bk-ctl"><span class="bk-ctl-l">${label}</span><div class="bk-pills">` + opts.map(([v, l]) =>
      `<button type="button" class="bk-pill${cur.includes(String(v)) ? " on" : ""}" data-smulti="${path}" data-sv="${esc(v)}" aria-pressed="${cur.includes(String(v))}">${l}</button>`).join("") + "</div></div>";
  },
  font(path, label, inherit){
    return `<label class="bk-field">${label}<select class="bk-select" data-ss="${path}">${fontOptions(getPath(path) || "", inherit)}</select></label>`;
  },
  step(path, label, d, min, max, def, unit){
    const v = getPath(path);
    const shown = (v == null || v === "") ? (def === "" ? "רגיל" : def + (unit ? " " + unit : "")) : v + (unit ? " " + unit : "");
    return `<div class="bk-ctl"><span class="bk-ctl-l">${label}</span><div class="bk-step"><button type="button" data-sstep="${path}" data-d="${-d}" data-min="${min}" data-max="${max}" data-def="${def === "" ? 1 : def}" aria-label="הקטן">−</button><span>${shown}</span><button type="button" data-sstep="${path}" data-d="${d}" data-min="${min}" data-max="${max}" data-def="${def === "" ? 0 : def}" aria-label="הגדל">+</button></div></div>`;
  },
  check(path, label, sub){
    return `<label class="bk-check"><input type="checkbox" data-sc="${path}"${getPath(path) ? " checked" : ""}/><span>${label}${sub ? "<small>" + sub + "</small>" : ""}</span></label>`;
  },
  text(path, label, ph){
    return `<label class="bk-field">${label}<input class="bk-input" data-st="${path}" value="${esc(getPath(path) ?? "")}" placeholder="${esc(ph || "")}"/></label>`;
  },
};
const WEIGHT = [["", "מודגש"], ["normal", "רגיל"]];
const ALIGN = [["", "רגיל"], ["center", "במרכז"], ["right", "לימין"], ["justify", "מיושר"]];
// the daf heading's looks, each drawn exactly as it prints (the page CSS is global in the studio)
function dafGallery(){
  const cur = dafLookOf(st), sample = esc(dafLabel({daf:5, amud:"א"}, st.dafFormat));
  const card = ([v, l, src]) => `<button type="button" class="bk-dafopt${cur === v ? " on" : ""}" data-sp="dafLook" data-sv="${v}" aria-pressed="${cur === v}">`
    + `<span class="bk-dafsample"><span class="bk-hdaf lk-${v}"><span class="t">${sample}</span></span></span>`
    + `<small>${esc(l)}</small>${src ? "<em>כמו " + esc(src) + "</em>" : ""}</button>`;
  return "<div class=\"bk-ctl\"><span class=\"bk-ctl-l\">צורת הכותרת — כמו בספרי השיעורים</span><div class=\"bk-dafgal\">"
    + DAF_LOOKS.filter(x => x[2]).map(card).join("") + "</div></div>"
    + "<div class=\"bk-ctl\"><span class=\"bk-ctl-l\">עוד צורות</span><div class=\"bk-dafgal\">"
    + DAF_LOOKS.filter(x => !x[2]).map(card).join("") + "</div></div>";
}
const LS = [["", "רגיל"], ["0.08", "מעט ריווח"], ["0.18", "ריווח"], ["0.3", "ריווח גדול"]];
function styleEditor(k){
  const e = (x) => "el." + k + "." + x;
  if(/^ps_/.test(k)){
    const id = k.slice(3), L = psLook(id), n = psList().filter(p => p.id === id).length;
    const used = (book.sections || []).reduce((c, s) => c + Object.values(s.pst || {}).filter(v => v === id).length, 0);
    return `<label class="bk-field">שם הסגנון<input class="bk-input" data-psname="${esc(id)}" value="${esc(psName(id))}"/></label>`
      + `<div class="bk-hint">בשימוש ב-${used} פסקאות${used ? "" : " — לוחצים על פסקה בדף ובוחרים «" + esc(psName(id)) + "»"}</div>`
      + SC.font(e("font"), "גופן", "כמו הטקסט") + SC.step(e("size"), "גודל", 5, 60, 250, L.size || 100, "%")
      + SC.pills(e("weight"), [["", "כמו הטקסט"], ["bold", "מודגש"], ["normal", "רגיל"]], "עובי")
      + SC.pills(e("align"), [["", "כמו הטקסט"], ["right", "לימין"], ["center", "במרכז"], ["justify", "מיושר לשני הצדדים"]], "יישור")
      + SC.step(e("indent"), "הזחה מהצד", 0.5, 0, 6, L.indent || 0, "em") + SC.pills(e("color"), [["", "שחור"], ["gray", "אפור"]], "צבע")
      + SC.step(e("before"), "רווח לפני", 0.2, 0, 4, "", "שורות") + SC.step(e("after"), "רווח אחרי", 0.2, 0, 4, "", "שורות")
      + SC.step(e("lh"), "מרווח בין השורות", 0.05, 1, 2.6, L.lh || Number(st.lineHeight) || 1.5, "")
      + SC.pills(e("box"), [["", "בלי"], ["frame", "▭ מסגרת"], ["shade", "▩ רקע אפור"]], "מסגרת")
      + SC.pills(e("keep"), [["", "רגיל"], ["all", "לא לחתוך בין עמודים"], ["next", "להשאיר עם הפסקה שאחריה"]], "בין עמודים")
      + SC.check(e("noOpen"), "בלי פתיחת פסקה", "האות הגדולה / החלון לא חלים על פסקאות בסגנון הזה")
      + SC.check(e("noDib"), "בלי דיבור המתחיל", "בפסקאות בסגנון הזה לא מודגשות המילים הראשונות")
      + (n && psList().length > 1 ? `<div class="bk-row" style="margin-top:8px"><button class="bk-btn bk-small bk-danger" type="button" data-psdel="${esc(id)}">🗑 למחוק את הסגנון</button></div>` : "");
  }
  const headCommon = () => SC.font(e("font"), "גופן", "כמו הכותרות") + SC.step(e("size"), "גודל", 5, 40, 300, 100, "%")
    + SC.pills(e("weight"), WEIGHT, "עובי") + SC.pills(e("align"), ALIGN, "יישור") + SC.pills(e("ls"), LS, "ריווח אותיות")
    + SC.step(e("before"), "רווח לפני", 0.2, 0, 6, "", "שורות") + SC.step(e("after"), "רווח אחרי", 0.2, 0, 6, "", "שורות");
  switch(k){
    case "body": return SC.font("bodyFont", "גופן") + SC.step("bodySize", "גודל אות", 0.5, 7, 24, 12, "נק'")
      + SC.step("lineHeight", "מרווח בין שורות", 0.05, 1.1, 2.4, 1.5, "") + SC.pills(e("align"), [["", "מיושר לשני הצדדים"], ["right", "לימין"], ["center", "במרכז"]], "יישור")
      + toDesign("חלוקה לפסקאות, הזחות ורווח בין פסקאות")
      + SC.step(e("indent"), "גודל ההזחה (רק כשנבחרה הזחה בלשונית עיצוב)", 0.2, 0, 5, "", "em") + SC.step(e("gap"), "רווח בין פסקאות", 0.1, 0, 2, "", "שורות")
      + SC.pills(e("density"), [["", "רגילה"], ["tight", "צפופה"], ["loose", "מרווחת"]], "צפיפות המילים")
      + SC.pills(e("ls"), [["", "רגיל"], ["-0.01", "צמוד"], ["0.02", "מעט מרווח"]], "ריווח אותיות")
      + SC.check("smartGeresh", "גרשיים מודפסים (״ ׳)", "ר\"ת נהפך ל־ר״ת, כמו בספר מודפס")
      + SC.check("keepAbbrev", "\"ר' משה\" לא נחתך בסוף שורה");
    case "dibur": return SC.pills("@dibwhere", [["none", "בלי"], ["numbered", "אחרי מספר"], ["first", "בתחילת כל קטע ואחרי מספר"], ["all", "בכל פסקה"]], "איפה")
      + SC.pills("@dibmode", [["marks", "עד סימן"], ["words", "מספר מילים"]], "עד איפה")
      + (st.diburUntil === "words" ? SC.step("diburWords", "כמה מילים", 1, 1, 12, 3, "")
         : SC.multi("@dibmarks", DIBUR_MARKS, "הסימן שמסיים את הדיבור המתחיל (אפשר לבחור כמה)"))
      + SC.check("diburPasuk", "הדיבור המתחיל הוא ציטוט מפסוק", "יוצא בסגנון \"📜 ציטוט מפסוק\" — לספר על התורה, שכל קטע פותח במילות הפסוק עד הסימן")
      + SC.font(e("font"), "גופן", "כמו הטקסט") + SC.step(e("size"), "גודל", 5, 60, 200, 100, "%")
      + SC.pills(e("weight"), WEIGHT, "עובי") + SC.pills(e("ls"), LS, "ריווח אותיות") + SC.check(e("u"), "קו מתחת")
      + SC.check("diburNewLine", "הביאור מתחיל בשורה חדשה", "הדיבור המתחיל עומד לבדו בשורה");
    case "num": return SC.pills("numFormat", [["keep", "כמו שכתבתי"], ["dot", "א."], ["paren", "א)"], ["both", "(א)"], ["bracket", "[א]"], ["half", "א]"]], "צורת המספר")
      + toDesign("זיהוי מספר בתחילת פסקה ופסקאות שמתחילות בספרה")
      + SC.font(e("font"), "גופן", "כמו הטקסט") + SC.step(e("size"), "גודל", 5, 60, 250, st.numSize === "normal" ? 100 : 132, "%")
      + SC.pills(e("weight"), WEIGHT, "עובי") + SC.check("entryGap", "רווח לפני כל דיבור ממוספר")
      + SC.step(e("gap"), "גודל הרווח", 0.1, 0, 3, "", "שורות");
    case "opener": return toDesign("צורת הפתיחה (אות גדולה, חלון…) ובאילו פסקאות")
      + SC.pills("openerWords", [[1, "מילה אחת"], [2, "שתי מילים"], [3, "שלוש מילים"]], "כמה מילים", true)
      + SC.font(e("font"), "גופן", "כמו הטקסט") + SC.step(e("size"), "גודל", 5, 80, 300, "", "%") + SC.pills(e("weight"), WEIGHT, "עובי");
    case "end": return SC.pills("@lastline", [["none", "רגילה"], ["section", "במרכז בסוף כל קטע"], ["every", "במרכז בסוף כל פסקה"]], "השורה האחרונה")
      + SC.pills("endMark", [["none", "בלי"], ["star", "✻"], ["diamond", "◆"], ["orn", "❖"], ["dot", "•"], ["colon", ":"]], "סימן בסוף כל קטע")
      + SC.pills("sectionSep", [["none", "בלי"], ["stars", "✻ ✻ ✻"], ["star2", "★ ☆ ★"], ["diamonds", "◆ ◇ ◆"], ["orn", "❖"], ["dots", "• • •"], ["line", "קו קצר"]], "מפריד בין סימנים")
      + SC.step(e("after"), "רווח אחרי כל קטע", 0.2, 0, 5, "", "שורות");
    case "h1": return SC.pills("hideChapter", [["", "מודפסות"], ["1", "מוסתרות — בלי כותרות פרקים"]], "כותרות הפרקים")
      + toDesign("צורת הכותרת, עמוד חדש לכל פרק, על פני שני הטורים, מספור אוטומטי")
      + headCommon() + SC.text("chapterWord", "המילה לפני המספר", "פרק");
    case "h2": return SC.pills("hideSiman", [["", "מודפסות"], ["1", "מוסתרות — בלי כותרות סימנים"]], "כותרות הסימנים")
      + SC.check("simanNoNum", "בלי מספור לסימנים", "לא יודפס \"סימן א\", \"סימן ב\"…")
      + toDesign("מקום הכותרת (בשורה נפרדת / בתחילת הפסקה) וצורתה")
      + headCommon() + SC.text("simanWord", "המילה לפני המספר", "סימן");
    case "h3": return SC.pills("subMode", [["", "ככותרת"], ["text", "כפסקה רגילה"], ["hide", "מוסתרות"]], "כותרות המשנה")
      + SC.check("subCenter", "במרכז") + headCommon();
    case "daf": return `<div class="bk-hint">בכל קטע בוחרים על איזה דף בגמרא הוא (לשונית תוכן ← עריכה ← "דף בגמרא").
      במקום שבו הדף מתחלף מודפסת כותרת משנה, וכותרת העמוד מראה את הדף שבראש העמוד.
      הצורות הראשונות לקוחות מספרי השיעורים שהסגנונות בנויים עליהם; כל סגנון "שיעורים" מתחיל בצורה של הספר שלו.</div>`
      + SC.pills("dafSub", [["", "מודפסת"], ["hide", "בלי"]], "כותרת משנה בתוך הטקסט")
      + dafGallery()
      + SC.pills("dafFormat", [["", "דף ה׳ ע״א"], ["dots", "דף ה. / דף ה:"], ["short", "ה׳ ע״א"], ["words", "דף ה׳ עמוד א׳"]], "איך כותבים את הדף")
      + (Number(st.columns) === 2 ? SC.check("dafSpan", "על פני שני הטורים", "כשמבוטל — בתוך הטור, חוץ ממקום שכותרת רחבה באה מיד אחריה") : "")
      + SC.font(e("font"), "גופן", "כמו הכותרות") + SC.step(e("size"), "גודל", 5, 60, 250, 100, "%") + SC.pills(e("weight"), WEIGHT, "עובי")
      + SC.pills(e("align"), [["", "במרכז"], ["right", "לימין"]], "מקום") + SC.pills(e("ls"), LS, "ריווח אותיות")
      + SC.step(e("before"), "רווח לפני", 0.2, 0, 6, "", "שורות") + SC.step(e("after"), "רווח אחרי", 0.2, 0, 6, "", "שורות")
      + SC.pills("dafHead", [["", "כן — במקום שם הסימן"], ["off", "לא"]], "הדף בכותרת שבראש העמוד")
      + `<div class="bk-hint bk-keep">שם המסכת שיודפס ליד הדף בראש העמוד: ${book && book.masechet ? "<b>" + esc(book.masechet) + "</b>" : "עדיין לא נכתב"} (בלשונית פרטים).</div>`;
    case "pasuk": return SC.check("pasukAuto", "כל מה שבתוך מירכאות ״…״ הוא ציטוט מפסוק", "הגדרה לכל הספר; ראשי תיבות קצרים (מ\"ש) לא נחשבים")
      + SC.font(e("font"), "גופן", "כמו הטקסט") + SC.step(e("size"), "גודל", 5, 60, 200, 100, "%")
      + SC.pills(e("weight"), WEIGHT, "עובי") + SC.pills(e("ls"), LS, "ריווח אותיות") + SC.check(e("u"), "קו מתחת")
      + SC.pills(e("color"), [["", "שחור"], ["gray", "אפור"]], "צבע");
    case "quoteIn": return toDesign("מה נחשב ציטוט ואם הוא בתוך הקטע או קטע נפרד")
      + SC.font(e("font"), "גופן", "כמו הטקסט") + SC.step(e("size"), "גודל", 5, 60, 200, 100, "%")
      + SC.pills(e("weight"), [["", "רגיל"], ["bold", "מודגש"]], "עובי") + SC.pills(e("ls"), [["", "מעט ריווח"], ["0", "רגיל"], ["0.18", "ריווח"]], "ריווח אותיות") + SC.check(e("u"), "קו מתחת")
      + SC.pills(e("color"), [["", "שחור"], ["gray", "אפור"]], "צבע");
    case "quote": return `<div class="bk-hint">שורה שמתחילה ב־&gt; יוצאת מוזחת משני הצדדים — ללשון הגמרא או לציטוט ארוך.</div>`
      + SC.pills("quotePlain", [["", "מוזח"], ["1", "כפסקה רגילה"]], "ציטוטים")
      + SC.font(e("font"), "גופן", "כמו הטקסט") + SC.step(e("size"), "גודל", 5, 60, 200, 95, "%") + SC.pills(e("weight"), [["", "רגיל"], ["bold", "מודגש"]], "עובי")
      + SC.pills(e("align"), ALIGN, "יישור") + SC.step(e("indent"), "הזחה מכל צד", 0.2, 0, 6, 1.6, "em")
      + SC.pills(e("color"), [["", "שחור"], ["gray", "אפור"]], "צבע");
    case "src": return toDesign("מראי מקומות בסוגריים באות קטנה — כן/לא")
      + SC.font(e("font"), "גופן", "כמו הטקסט") + SC.step(e("size"), "גודל", 5, 50, 120, 84, "%")
      + SC.pills(e("color"), [["", "שחור"], ["gray", "אפור"]], "צבע");
    case "notes": return SC.font("noteFont", "גופן") + SC.step("noteSize", "גודל", 0.5, 6, 16, 9, "נק'")
      + SC.step(e("leading"), "מרווח בין שורות", 0.05, 1, 2.2, "", "") + toDesign("טורים, סימון, סידור ומספור ההערות")
      + (st.noteSep === "text" ? SC.text("noteSepText", "נוסח הכותרת", "הערות וביאורים") : "")
      + SC.pills(e("labelWeight"), WEIGHT, "מספר ההערה");
    case "head": return toDesign("מה כתוב בכותרת העליונה")
      + SC.font(e("font"), "גופן", "כמו הטקסט") + SC.step(e("size"), "גודל", 5, 50, 200, 100, "%") + SC.pills(e("weight"), WEIGHT, "עובי")
      + SC.pills(e("ls"), LS, "ריווח אותיות");
    case "pnum": return toDesign("ספירת העמודים (א ב ג / 1 2 3 / דפים) ומקום המספר")
      + SC.step(e("size"), "גודל", 5, 60, 250, 100, "%") + SC.pills(e("weight"), WEIGHT, "עובי");
    case "side": return `<div class="bk-hint">כותרת קטנה בשוליים, ליד הפסקה: כותבים [[כותרת]] בתחילת הפסקה.
      בעימוד של שני טורים אין שוליים ליד הטור השמאלי, ולכן הכותרת יוצאת מודגשת בתחילת הפסקה.</div>`
      + SC.pills("sideHide", [["", "מודפסות"], ["1", "מוסתרות"]], "כותרות בשוליים")
      + SC.font(e("font"), "גופן", "כמו הטקסט") + SC.step(e("size"), "גודל", 5, 40, 150, 68, "%") + SC.pills(e("weight"), WEIGHT, "עובי");
    case "cols": return toDesign("טור אחד או שניים") + SC.step(e("gap"), "רווח בין הטורים", 0.5, 2, 20, 6, "מ\"מ");
  }
  return "";
}
function renderStyles(){
  const P = $("bkPanelStyles");
  if(!st) return;
  const SIMPLE_EL = ["body", "dibur", "pasuk", "quoteIn", "num", "opener", "h1", "h2", "h3", "notes"];
  const btns = ELEMENTS.map(([k, name, ico]) => `<button type="button" class="bk-elbtn${k === stylesSel ? " on" : ""}${SIMPLE_EL.includes(k) ? "" : " bk-adv-only"}" data-el="${k}"><i>${esc(ico)}</i>${name}</button>`).join("");
  const psKey = (id) => id === "pasuk" ? "pasuk" : id === "quote" ? "quote" : "ps_" + id;
  const psBtns = psList().map(P => `<button type="button" class="bk-elbtn${psKey(P.id) === stylesSel ? " on" : ""}" data-el="${esc(psKey(P.id))}"><i>¶</i>${esc(P.name)}</button>`).join("")
    + `<button type="button" class="bk-elbtn bk-psnew" data-psnew="1"><i>＋</i>סגנון חדש</button>`;
  const uf = USER_FONTS.length ? "<div class=\"bk-hint bk-keep\">גופנים שהוספת: " + USER_FONTS.map(f => esc(f.label)).join(" · ") + "</div>" : "";
  P.innerHTML = `
${helpBox("styles")}
<h3 class="bk-h" style="margin-top:0">¶ סגנונות הפסקאות בספר הזה</h3>
<div class="bk-hint">לוחצים על פסקה בדף ובוחרים לה סגנון. כאן קובעים איך כל סגנון נראה — וזה משתנה בכל הספר.</div>
<div class="bk-elgrid">${psBtns}</div>
<h3 class="bk-h">🖋 חלקי הספר</h3>
<div class="bk-elgrid">${btns}</div>
<div class="bk-sub bk-eled"><h3 class="bk-h" style="margin-top:0">🖋 ${elName(stylesSel)}</h3><div class="bk-help">${ELEMENT_HELP[stylesSel] || ""}</div>${styleEditor(stylesSel)}
<div class="bk-row" style="margin-top:8px"><button class="bk-btn bk-small" type="button" data-elreset="${stylesSel}">↺ החזר לברירת המחדל של הסגנון</button></div></div>
<h3 class="bk-h">🔤 גופנים</h3>
<div class="bk-sub"><div class="bk-hint">בתוכנה יש גופנים של ספרי קודש: וילנא, הדסה, רש"י, דרוגולין, סת"ם, כתר ועוד. גופנים שמותקנים במחשב (כמו גוטמן) מופיעים לבד.
 יש לכם גופן אחר (קובץ ‎.ttf‎ או ‎.otf‎)? אפשר להוסיף אותו:</div>
<button class="bk-btn bk-soft" type="button" id="bkAddFont">📁 הוסף גופן מהמחשב</button>${uf}</div>`;
}
document.addEventListener("change", (e) => {
  const n = e.target.closest && e.target.closest("[data-psname]");
  if(!n || !st) return;
  const v = n.value.trim(); if(!v) return;
  st.pstyles = psList().map(x => x.id === n.dataset.psname ? Object.assign({}, x, {name: v}) : Object.assign({}, x));
  markDirty(); renderStyles(); toast("✓ השם נשמר: «" + v + "»", "ok");
});
function stylesChanged(){ markDirty(); scheduleLayout(120); const sc = $("bkPanelStyles").scrollTop; renderStyles(); $("bkPanelStyles").scrollTop = sc; }
function onStylesClick(e){
  const el = e.target.closest("[data-el]");
  if(el){ stylesSel = el.dataset.el; renderStyles(); return; }
  if(e.target.closest("[data-psnew]")){
    const list = psList().map(x => Object.assign({}, x)); let i = 1; while(list.some(x => x.id === "my" + i)) i++;
    list.push({id:"my" + i, name:"סגנון " + (list.length + 1)}); st.pstyles = list; stylesSel = "ps_my" + i;
    stylesChanged(); toast("✓ נוסף סגנון חדש — תנו לו שם וקבעו איך הוא נראה", "ok"); return;
  }
  const pd = e.target.closest("[data-psdel]");
  if(pd){
    const id = pd.dataset.psdel;
    st.pstyles = psList().filter(x => x.id !== id).map(x => Object.assign({}, x));
    for(const s of book.sections || []){ if(s.pst){ for(const k of Object.keys(s.pst)) if(s.pst[k] === id) delete s.pst[k]; if(!Object.keys(s.pst).length) delete s.pst; } }
    stylesSel = "body"; stylesChanged(); toast("הסגנון נמחק; הפסקאות שהיו בו חזרו לרגיל", "ok"); return;
  }
  const gt = e.target.closest("[data-gotab]");
  if(gt){ setTab(gt.dataset.gotab); return; }
  const mp = e.target.closest("[data-smulti]");
  if(mp){
    const cur = String(getPath(mp.dataset.smulti) ?? "").split(",").filter(Boolean);
    const at = cur.indexOf(mp.dataset.sv);
    if(at >= 0){ if(cur.length === 1){ toast("צריך להשאיר לפחות סימן אחד", "warn"); return; } cur.splice(at, 1); }
    else cur.push(mp.dataset.sv);
    setPath(mp.dataset.smulti, cur.join(","));
    reportChange(choiceName(mp), mp.dataset.smulti);
    stylesChanged(); return;
  }
  const pl = e.target.closest("[data-sp]");
  if(pl){
    setPath(pl.dataset.sp, pl.dataset.num ? Number(pl.dataset.sv) : pl.dataset.sv);
    if(pl.dataset.sp === "opener" && (pl.dataset.sv === "letter" || pl.dataset.sv === "window")) st.openerEvery = true;
    if(PARA_KEYS.includes(pl.dataset.sp)) needParas();
    reportChange(choiceName(pl), pl.dataset.sp);
    stylesChanged(); return;
  }
  const sb = e.target.closest("[data-sstep]");
  if(sb){
    const path = sb.dataset.sstep;
    let v = getPath(path);
    if(v == null || v === "") v = Number(sb.dataset.def);
    v = Math.round((Number(v) + Number(sb.dataset.d)) * 100) / 100;
    setPath(path, Math.max(Number(sb.dataset.min), Math.min(Number(sb.dataset.max), v)));
    stylesChanged(); return;
  }
  const rs = e.target.closest("[data-elreset]");
  if(rs){ if(st.el) delete st.el[rs.dataset.elreset]; stylesChanged(); toast("הסגנון חזר לברירת המחדל", "ok"); return; }
  if(e.target.closest("#bkAddFont")) addUserFont();
}
function onStylesChange(e){
  const t = e.target;
  if(t.dataset.ss){ setPath(t.dataset.ss, t.value); stylesChanged(); return; }
  if(t.dataset.sc){ setPath(t.dataset.sc, t.checked); if(t.checked && PARA_KEYS.includes(t.dataset.sc)) needParas(); stylesChanged(); reportChange(chkName(t) + (t.checked ? " — פועל" : " — כבוי"), t.dataset.sc); }
}
function onStylesInput(e){
  const t = e.target;
  if(t.dataset.st){ setPath(t.dataset.st, t.value.trim()); markDirty(); scheduleLayout(); }
}
function addUserFont(){
  const inp = h("input", {type:"file", accept:".ttf,.otf"});
  inp.style.display = "none";
  ROOT.appendChild(inp);
  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    inp.remove();
    if(!f) return;
    try{
      const res = await call("/api/book/font?name=" + encodeURIComponent(f.name), {method:"POST", headers:{"Content-Type":"application/octet-stream"}, body: await f.arrayBuffer()});
      await loadFontCatalog();
      injectPageCSS();
      renderStyles();
      toast("✓ הגופן \"" + (res.label || f.name) + "\" נוסף — בחרו אותו ברשימות הגופנים", "ok");
    }catch(e){ toast(e.message || String(e), "err"); }
  });
  inp.click();
}

/* ---------------------------------------------------------------- tools */
/* ---------------------------------------------------- מראי מקומות (sources) */
// Eli's list (11-01) B1 מפתח, B2 בדיקת מראי מקומות, B3 איחוד ראשי תיבות. A reference is recognised
// only in its full form — a known book + a number that is a real Hebrew number + (for the Gemara)
// an amud mark — so words like "שבת" or "דברים" in running text are never taken for sources.
const SRC_MAS = [["ברכות",64,["ברכ'"]], ["שבת",157,[]], ["עירובין",105,["ערובין","עירו'"]], ["פסחים",121,["פסח'"]],
  ["שקלים",22,[]], ["יומא",88,[]], ["סוכה",56,[]], ["ביצה",40,[]], ["ראש השנה",35,["ר\"ה"]], ["תענית",31,[]],
  ["מגילה",32,[]], ["מועד קטן",29,["מו\"ק"]], ["חגיגה",27,[]], ["יבמות",122,["יבמ'"]], ["כתובות",112,["כתו'"]],
  ["נדרים",91,[]], ["נזיר",66,[]], ["סוטה",49,[]], ["גיטין",90,[]], ["קידושין",82,["קדושין","קידו'"]],
  ["בבא קמא",119,["ב\"ק"]], ["בבא מציעא",119,["ב\"מ"]], ["בבא בתרא",176,["ב\"ב"]], ["סנהדרין",113,["סנה'"]],
  ["מכות",24,[]], ["שבועות",49,["שבוע'"]], ["עבודה זרה",76,["ע\"ז"]], ["הוריות",14,[]], ["זבחים",120,[]],
  ["מנחות",110,[]], ["חולין",142,[]], ["בכורות",61,[]], ["ערכין",34,[]], ["תמורה",34,[]], ["כריתות",28,[]],
  ["מעילה",22,[]], ["נדה",73,["נידה"]]];
const SRC_TNK = [["בראשית",50,["בר'"]], ["שמות",40,["שמ'"]], ["ויקרא",27,["ויק'"]], ["במדבר",36,["במ'"]], ["דברים",34,["דב'"]],
  ["יהושע",24,[]], ["שופטים",21,[]], ["שמואל א",31,["ש\"א"]], ["שמואל ב",24,["ש\"ב"]], ["מלכים א",22,["מ\"א"]],
  ["מלכים ב",25,["מ\"ב"]], ["ישעיה",66,["ישעיהו"]], ["ירמיה",52,["ירמיהו"]], ["יחזקאל",48,[]], ["הושע",14,[]], ["יואל",4,[]],
  ["עמוס",9,[]], ["עובדיה",1,[]], ["יונה",4,[]], ["מיכה",7,[]], ["נחום",3,[]], ["חבקוק",3,[]], ["צפניה",3,[]],
  ["חגי",2,[]], ["זכריה",14,[]], ["מלאכי",3,[]], ["תהלים",150,["תהילים","תה'"]], ["משלי",31,[]], ["איוב",42,[]],
  ["שיר השירים",8,["שה\"ש"]], ["רות",4,[]], ["איכה",5,[]], ["קהלת",12,[]], ["אסתר",10,[]], ["דניאל",12,[]],
  ["עזרא",10,[]], ["נחמיה",13,[]], ["דברי הימים א",29,["דה\"א"]], ["דברי הימים ב",36,["דה\"ב"]]];
const HEBV = {"א":1,"ב":2,"ג":3,"ד":4,"ה":5,"ו":6,"ז":7,"ח":8,"ט":9,"י":10,"כ":20,"ך":20,"ל":30,"מ":40,"ם":40,"נ":50,"ן":50,
  "ס":60,"ע":70,"פ":80,"ף":80,"צ":90,"ץ":90,"ק":100,"ר":200,"ש":300,"ת":400};
// a real Hebrew number (letters in falling value, ט"ו/ט"ז allowed), or 0
function hebNum(tok){
  const t = String(tok || "").replace(/["'״׳]/g, "");
  if(!t || t.length > 4 || /[^א-ת]/.test(t)) return 0;
  if(t === "טו" || t === "טז") return t === "טו" ? 15 : 16;
  let n = 0, last = 1e9;
  for(const c of t){ const v = HEBV[c]; if(!v || v > last) return 0; n += v; last = v; }
  return /יה$|יו$/.test(t) ? 0 : n;            // 15/16 are written ט"ו / ט"ז, never יה / יו
}
const srcNorm = (s) => String(s || "").replace(/״/g, "\"").replace(/׳/g, "'").replace(/[֑-ׇ]/g, "");
const srcEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function srcNameRe(list){
  const forms = [];
  list.forEach(([name, , abbr], i) => { forms.push([name, i]); for(const a of abbr) forms.push([a, i]); });
  forms.sort((a, b) => b[0].length - a[0].length);
  return {forms, re: forms.map(f => srcEsc(f[0])).join("|")};
}
const SRC_M = srcNameRe(SRC_MAS), SRC_T = srcNameRe(SRC_TNK);
const NUM_T = "[א-ת][א-ת\"']{0,4}";
// Gemara: "ב"ב ג." · "בבא בתרא דף ג ע"א" · "שבת קיט:" — the amud mark is required
const RE_MAS = new RegExp("(^|[\\s(\\[{,;])([ובדלמשהכ]{0,3}?)(" + SRC_M.re + ")\\s+(?:דף\\s+)?(" + NUM_T + "?)(?:\\s*([.:])|\\s+(?:ע\"|עמוד\\s+)([אב])['\"]?)(?=$|[\\s),.;:\\]}])", "g");
// Tanakh: "בראשית א, ג" · "(שמות כ ב)" — a chapter and a verse, both real numbers
const RE_TNK = new RegExp("(^|[\\s(\\[{,;])([ובדלמשהכ]{0,3}?)(" + SRC_T.re + ")\\s+(" + NUM_T + ")[,\\s]\\s*(" + NUM_T + ")(?=$|[\\s),.;:\\]}])", "g");
// every reference in a piece of text: {kind, book (canonical index), form (as written), a, b, at, len, amudForm}
function findSources(text){
  const t = srcNorm(text), out = [];
  let m;
  RE_MAS.lastIndex = 0;
  while((m = RE_MAS.exec(t))){
    const f = SRC_M.forms.find(x => x[0] === m[3]);
    const daf = hebNum(m[4]); if(!f || !daf) continue;
    const amud = m[5] ? (m[5] === "." ? 1 : 2) : (m[6] === "א" ? 1 : 2);
    const pre = m[1].length + m[2].length;          // a prefix letter (ו, ב, ד…) stays in the text untouched
    out.push({kind:"mas", book:f[1], form:m[3], a:daf, b:amud, at:m.index + pre, len:m[0].length - pre,
      amudForm: m[5] ? "dots" : "ayin"});
  }
  RE_TNK.lastIndex = 0;
  while((m = RE_TNK.exec(t))){
    const f = SRC_T.forms.find(x => x[0] === m[3]);
    const ch = hebNum(m[4]), v = hebNum(m[5]); if(!f || !ch || !v || v > 176) continue;
    const pre = m[1].length + m[2].length;
    out.push({kind:"tnk", book:f[1], form:m[3], a:ch, b:v, at:m.index + pre, len:m[0].length - pre});
  }
  return out;
}
const srcBookName = (r) => (r.kind === "mas" ? SRC_MAS : SRC_TNK)[r.book][0];
const srcLabel = (r) => r.kind === "mas" ? "דף " + gem(r.a) + " ע\"" + (r.b === 1 ? "א" : "ב") : gem(r.a) + ", " + gem(r.b);
const srcOk = (r) => r.a <= (r.kind === "mas" ? SRC_MAS : SRC_TNK)[r.book][1] && (r.kind !== "mas" || r.a >= 2);

/* B1: the index of sources, built from the laid-out pages (which page each reference is on) */
function indexBlocks(bodyPages, numFmt){
  const map = new Map();                      // key -> {r, pages:Set}
  for(const P of bodyPages){
    if(P.kind !== "body") continue;
    const txt = [...P.el.querySelectorAll(".bk-flow, .bk-notes")].map(x => x.textContent).join(" ");
    for(const r of findSources(txt)){
      if(!srcOk(r)) continue;
      const key = r.kind + "|" + r.book + "|" + r.a + "|" + r.b;
      if(!map.has(key)) map.set(key, {r, pages: new Set()});
      map.get(key).pages.add(P.n);
    }
  }
  if(!map.size) return null;
  const all = [...map.values()].sort((x, y) => (x.r.kind === y.r.kind ? 0 : x.r.kind === "tnk" ? -1 : 1)
    || x.r.book - y.r.book || x.r.a - y.r.a || x.r.b - y.r.b);
  const out = [{t:"h1", label:"", title:"מפתח המקורות", hdr:"מפתח המקורות", newPage:true, reset:"chapter", uid:"hindex"}];
  let lastBook = "";
  for(const e of all){
    const head = (e.r.kind === "tnk" ? "" : "מסכת ") + srcBookName(e.r);
    if(head !== lastBook){ out.push({t:"toc", lvl:0, title:head, num:"", uid:uid("x")}); lastBook = head; }
    out.push({t:"toc", lvl:2, title:srcLabel(e.r), num:[...e.pages].sort((a, b) => a - b).map(numFmt).join(", "), uid:uid("x")});
  }
  return out;
}

/* B2: check the references: a daf / chapter that does not exist, and one book written in several ways */
function sourceIssues(){
  const bad = [], forms = new Map(), amud = {dots:0, ayin:0};
  for(const sec of book.sections){
    String(sec.text || "").split("\n").forEach((line, ln) => {
      const norm = srcNorm(line);
      for(const r of findSources(norm)){
        const k = r.kind + "|" + r.book;
        if(!forms.has(k)) forms.set(k, new Map());
        forms.get(k).set(r.form, (forms.get(k).get(r.form) || 0) + 1);
        if(r.kind === "mas") amud[r.amudForm]++;
        if(!srcOk(r)){
          const max = (r.kind === "mas" ? SRC_MAS : SRC_TNK)[r.book][1];
          bad.push({sec, ln, at:r.at, len:r.len, text:norm.substr(r.at, r.len),
            why: r.kind === "mas" ? `במסכת ${srcBookName(r)} יש ${gem(max)} דפים (עד דף ${gem(max)})` : `ב${srcBookName(r)} יש ${max} פרקים`});
        }
      }
    });
  }
  const mixed = [];
  for(const [k, m] of forms){
    if(m.size < 2) continue;
    const [kind, b] = k.split("|");
    const list = [...m.entries()].sort((x, y) => y[1] - x[1]);
    mixed.push({kind, book:Number(b), name:(kind === "mas" ? SRC_MAS : SRC_TNK)[Number(b)][0], list});
  }
  return {bad, mixed, amud};
}
// replace one written form of a book by another, ONLY where it opens a reference
function unifySourceForm(kind, bookIdx, to){
  let n = 0;
  for(const sec of book.sections){
    const t = srcNorm(sec.text);
    const refs = findSources(t).filter(r => r.kind === kind && r.book === bookIdx && r.form !== to).sort((x, y) => y.at - x.at);
    if(!refs.length) continue;
    let s = t;
    for(const r of refs){ s = s.slice(0, r.at) + to + s.slice(r.at + r.form.length); n++; }
    sec.text = s;
  }
  return n;
}
function unifyAmud(to){
  let n = 0;
  for(const sec of book.sections){
    const t = srcNorm(sec.text);
    const refs = findSources(t).filter(r => r.kind === "mas" && r.amudForm !== to).sort((x, y) => y.at - x.at);
    if(!refs.length) continue;
    let s = t;
    for(const r of refs){
      const name = r.form, daf = gem(r.a);
      const nu = to === "dots" ? name + " " + daf + (r.b === 1 ? "." : ":") : name + " " + daf + " ע\"" + (r.b === 1 ? "א" : "ב");
      s = s.slice(0, r.at) + nu + s.slice(r.at + r.len); n++;
    }
    sec.text = s;
  }
  return n;
}
function checkSources(){
  const {bad, mixed, amud} = sourceIssues();
  const total = book.sections.reduce((n, s) => n + findSources(srcNorm(s.text)).length, 0);
  const rowsBad = bad.slice(0, 80).map((x, i) => `<div class="bk-item"><span class="bk-grow"><b>${esc(x.text)}</b><small>${esc(x.why)} · ${esc(x.sec.title || KIND_LABEL[x.sec.kind] || "")} שורה ${x.ln + 1}</small></span>
    <button class="bk-btn bk-small" type="button" data-sbad="${i}">הצג</button></div>`).join("");
  const rowsMix = mixed.map((x, i) => `<div class="bk-item"><span class="bk-grow"><b>${esc(x.kind === "mas" ? "מסכת " + x.name : x.name)}</b>
    <small>כתוב ב־${x.list.length} צורות: ${x.list.map(([f, c]) => "«" + esc(f) + "» (" + c + ")").join(", ")}</small></span>
    ${x.list.map(([f]) => `<button class="bk-btn bk-small" type="button" data-smix="${i}" data-to="${esc(f)}">הכל «${esc(f)}»</button>`).join("")}</div>`).join("");
  const amudRow = amud.dots && amud.ayin ? `<div class="bk-item"><span class="bk-grow"><b>סימון העמוד בגמרא</b><small>«ה.» / «ה:» (${amud.dots}) · «ה ע"א» / «ה ע"ב» (${amud.ayin})</small></span>
    <button class="bk-btn bk-small" type="button" data-samud="dots">הכל «ה.»</button><button class="bk-btn bk-small" type="button" data-samud="ayin">הכל «ה ע"א»</button></div>` : "";
  const D = modal(`<header><h3>📚 בדיקת מראי מקומות</h3></header><div class="bk-dbody">
    <div>נמצאו בספר ${total} מראי מקומות (גמרא ותנ"ך).</div>
    <h4 class="bk-tph">${bad.length ? "⚠ " + bad.length + " מקומות שלא קיימים" : "✓ כל המקומות קיימים"}</h4><div class="bk-list">${rowsBad}</div>
    <h4 class="bk-tph">${mixed.length || amudRow ? "✍ כתיבה לא אחידה" : "✓ כל ספר כתוב באותה צורה בכל הספר"}</h4><div class="bk-list">${rowsMix}${amudRow}</div>
  </div><footer><button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelectorAll("[data-sbad]").forEach(b => b.addEventListener("click", () => { const x = bad[Number(b.dataset.sbad)]; closeModal(); goToLine(x.sec.id, x.ln, x.at, x.len); }));
  D.querySelectorAll("[data-smix]").forEach(b => b.addEventListener("click", () => {
    const x = mixed[Number(b.dataset.smix)];
    const n = unifySourceForm(x.kind, x.book, b.dataset.to);
    markDirty(); renderSections(); scheduleLayout(0); closeModal();
    toast("✓ " + n + " מקומות נכתבו «" + b.dataset.to + "» (אפשר לבטל עם ↶)", "ok");
  }));
  D.querySelectorAll("[data-samud]").forEach(b => b.addEventListener("click", () => {
    const n = unifyAmud(b.dataset.samud);
    markDirty(); renderSections(); scheduleLayout(0); closeModal();
    toast("✓ " + n + " מקומות בגמרא אוחדו (אפשר לבטל עם ↶)", "ok");
  }));
}

/* B3: one way of writing each abbreviation in the whole book */
const ABBR_PAIRS = [["אכמ\"ל", "אין כאן מקום להאריך"], ["עיי\"ש", "עיין שם"], ["ע\"ש", "עיין שם"], ["הנ\"ל", "הנזכר לעיל"],
  ["וכו'", "וכולי"], ["ז\"ל", "זכרונו לברכה"], ["זצ\"ל", "זכר צדיק לברכה"], ["ע\"כ", "עד כאן"], ["וז\"ל", "וזה לשונו"],
  ["ע\"פ", "על פי"], ["אע\"פ", "אף על פי"], ["ק\"ו", "קל וחומר"], ["צ\"ע", "צריך עיון"], ["א\"כ", "אם כן"], ["כ\"כ", "כל כך"],
  ["בד\"א", "במה דברים אמורים"], ["ר\"ל", "רוצה לומר"], ["ד\"ה", "דיבור המתחיל"], ["הקב\"ה", "הקדוש ברוך הוא"], ["שליט\"א", "שיחיה לאורך ימים טובים אמן"]];
const wordRe = (w) => new RegExp("(^|[^א-ת\"'״׳])([והבכלמש]{0,2}?)" + srcEsc(w).replace(/"/g, "[\"״]").replace(/'/g, "['׳]") + "(?=$|[^א-ת\"'״׳])", "g");
function abbrIssues(){
  const all = book.sections.map(s => String(s.text || "")).join("\n");
  const pairs = [];
  for(const [ab, full] of ABBR_PAIRS){
    const a = (all.match(wordRe(ab)) || []).length, f = (all.match(wordRe(full)) || []).length;
    if(a && f) pairs.push({ab, full, a, f});
  }
  // gershayim: the typed " ' against the printed ״ ׳ inside words
  const typed = (all.match(/[א-ת]["'][א-ת]?/g) || []).length, printed = (all.match(/[א-ת][״׳][א-ת]?/g) || []).length;
  return {pairs, typed, printed};
}
function replaceWord(from, to){
  let n = 0;
  for(const sec of book.sections){
    sec.text = String(sec.text || "").replace(wordRe(from), (m, pre, pfx) => { n++; return pre + pfx + to; });
  }
  return n;
}
function checkAbbr(){
  const {pairs, typed, printed} = abbrIssues();
  const rows = pairs.map((x, i) => `<div class="bk-item"><span class="bk-grow"><b>«${esc(x.ab)}» (${x.a}) · «${esc(x.full)}» (${x.f})</b><small>אותו דבר כתוב פעם בקיצור ופעם במלואו</small></span>
    <button class="bk-btn bk-small" type="button" data-ab="${i}" data-to="ab">הכל «${esc(x.ab)}»</button>
    <button class="bk-btn bk-small" type="button" data-ab="${i}" data-to="full">הכל «${esc(x.full)}»</button></div>`).join("");
  const gRow = typed && printed ? `<div class="bk-item"><span class="bk-grow"><b>גרשיים: «"» (${typed}) · «״» (${printed})</b><small>ראשי תיבות כתובים פעם במירכאות רגילות ופעם בגרשיים של דפוס</small></span>
    <button class="bk-btn bk-small" type="button" data-gr="printed">הכל «״»</button><button class="bk-btn bk-small" type="button" data-gr="typed">הכל «"»</button></div>` : "";
  const D = modal(`<header><h3>✍ איחוד ראשי תיבות</h3></header><div class="bk-dbody">
    <div>${pairs.length || gRow ? "אותו ביטוי כתוב בספר ביותר מצורה אחת. בוחרים צורה אחת, והיא נכתבת בכל הספר:" : "✓ כל ראשי התיבות שבדקתי כתובים בספר בצורה אחת"}</div>
    <div class="bk-list">${rows}${gRow}</div>
    <small class="bk-tpnote">נבדקים ${ABBR_PAIRS.length} ביטויים נפוצים (אכמ"ל, עיי"ש, הנ"ל, וכו' ועוד). אפשר לבטל כל שינוי עם ↶.</small>
  </div><footer><button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelectorAll("[data-ab]").forEach(b => b.addEventListener("click", () => {
    const x = pairs[Number(b.dataset.ab)];
    const n = b.dataset.to === "ab" ? replaceWord(x.full, x.ab) : replaceWord(x.ab, x.full);
    markDirty(); renderSections(); scheduleLayout(0); closeModal();
    toast("✓ " + n + " מקומות אוחדו (אפשר לבטל עם ↶)", "ok");
  }));
  D.querySelectorAll("[data-gr]").forEach(b => b.addEventListener("click", () => {
    let n = 0;
    for(const sec of book.sections){
      sec.text = String(sec.text || "").replace(b.dataset.gr === "printed" ? /([א-ת])"(?=[א-ת])/g : /([א-ת])״(?=[א-ת])/g, (m, a) => { n++; return a + (b.dataset.gr === "printed" ? "״" : "\""); })
        .replace(b.dataset.gr === "printed" ? /([א-ת])'(?=$|[^א-ת])/g : /([א-ת])׳(?=$|[^א-ת])/g, (m, a) => { n++; return a + (b.dataset.gr === "printed" ? "׳" : "'"); });
    }
    markDirty(); renderSections(); scheduleLayout(0); closeModal();
    toast("✓ " + n + " סימנים אוחדו (אפשר לבטל עם ↶)", "ok");
  }));
}

/* --------------------------------------------------------- בדיקת איות (B4) */
// Eli's list (11-01) B4. The dictionary is the 200,000 most frequent words of Otzar HaChochma —
// the language of the sefarim, not modern Hebrew — so "דהיינו", "ומיהו", "קושיא" are words, not errors.
// A word counts as known with up to three prefix letters (ו ה ב כ ל מ ש), or when it is an
// abbreviation (it has ' or "), a Hebrew number, or one letter. A word Abba marks "זה נכון" is kept
// on this computer and never asked about again.
let SPELL = null;              // Map word -> rank (0 = most frequent)
async function spellDict(){
  if(SPELL) return SPELL;
  const res = await fetch("/book/spell.txt", {cache:"force-cache"});
  if(!res.ok) throw new Error("רשימת המילים לא נטענה");
  const lines = (await res.text()).split(/\r?\n/);
  SPELL = new Map();
  let r = 0;
  for(const w of lines){ if(w && w[0] !== "#") SPELL.set(w, r++); }
  return SPELL;
}
const spellOk = () => { try{ return new Set(JSON.parse(lsGet("bk_spell_ok", "[]") || "[]")); }catch(e){ return new Set(); } };
const FINAL = {"מ":"ם", "נ":"ן", "צ":"ץ", "פ":"ף", "כ":"ך"};
function spellKnown(D, w, ok){
  if(w.length < 2 || ok.has(w) || /["'״׳]/.test(w)) return true;
  if(FINAL[w[w.length - 1]]) return false;          // "שלומ": a word never ends in a regular מ נ צ פ כ
  if(D.has(w)) return true;
  if(hebNum(w)) return true;
  for(let k = 1; k <= 3 && k < w.length - 1; k++){
    if(!/^[והבכלמש]+$/.test(w.slice(0, k))) break;
    if(D.has(w.slice(k))) return true;
  }
  return false;
}
// up to three likely words: one letter missing, extra, changed or two swapped; the more frequent first
function spellSuggest(D, w){
  const A = "אבגדהוזחטיכלמנסעפצקרשתךםןףץ", c = new Set();
  for(let i = 0; i <= w.length; i++){
    if(i < w.length) c.add(w.slice(0, i) + w.slice(i + 1));
    if(i < w.length - 1) c.add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
    for(const ch of A){
      if(i < w.length) c.add(w.slice(0, i) + ch + w.slice(i + 1));
      c.add(w.slice(0, i) + ch + w.slice(i));
    }
  }
  c.delete(w);
  const fin = FINAL[w[w.length - 1]] ? w.slice(0, -1) + FINAL[w[w.length - 1]] : "";
  const out = [...c].filter(x => D.has(x) && x !== fin).sort((a, b) => D.get(a) - D.get(b));
  return (fin && (D.has(fin) || w.length > 2) ? [fin] : []).concat(out).slice(0, 3);
}
const SPELL_WORD = /[א-ת][א-ת"'״׳]*[א-ת]|[א-ת]/g;
function spellScan(D){
  const ok = spellOk(), found = new Map();       // word -> {n, sec, ln, at}
  for(const sec of book.sections){
    String(sec.text || "").split("\n").forEach((line, ln) => {
      // the words as printed: no nikud, no word tags, no note markers
      const clean = line.replace(/[֑-ׇ]/g, "").replace(ANY_TAG_G, m => " ".repeat(m.length));
      let m; SPELL_WORD.lastIndex = 0;
      while((m = SPELL_WORD.exec(clean))){
        const w = m[0].replace(/[״]/g, "\"").replace(/[׳]/g, "'");
        if(spellKnown(D, w, ok)) continue;
        const e = found.get(w);
        if(e) e.n++; else found.set(w, {n:1, sec, ln, at:m.index, len:m[0].length});
      }
    });
  }
  return [...found.entries()].sort((a, b) => b[1].n - a[1].n);
}
async function checkSpelling(){
  progressBox("בודק איות…");
  let D;
  try{ D = await spellDict(); }catch(e){ closeModal(); toast(e.message || String(e), "err"); return; }
  const list = spellScan(D);
  const shown = list.slice(0, 120);
  const rows = shown.map(([w, x], i) => {
    const sug = spellSuggest(D, w);
    return `<div class="bk-item"><span class="bk-grow"><b>${esc(w)}</b><small>${x.n > 1 ? x.n + " פעמים · " : ""}${esc(x.sec.title || KIND_LABEL[x.sec.kind] || "")} שורה ${x.ln + 1}</small></span>
      <button class="bk-btn bk-small" type="button" data-sp-go="${i}">הצג</button>
      ${sug.map(s => `<button class="bk-btn bk-small bk-soft" type="button" data-sp-fix="${i}" data-to="${esc(s)}">← ${esc(s)}</button>`).join("")}
      <button class="bk-btn bk-small" type="button" data-sp-ok="${i}" title="המילה נכונה — לא לשאול עליה שוב">זה נכון</button></div>`;
  }).join("");
  const D2 = modal(`<header><h3>🔤 בדיקת איות</h3></header><div class="bk-dbody">
    <div>${list.length ? `נמצאו ${list.length} מילים שאינן ברשימת המילים של ספרי הקודש${list.length > shown.length ? " (מוצגות " + shown.length + " הנפוצות)" : ""}. רובן שמות או מילים נדירות — בוחרים מה לתקן:` : "✓ לא נמצאו מילים חשודות"}</div>
    <div class="bk-list">${rows}</div>
    <small class="bk-tpnote">הרשימה: 200,000 המילים הנפוצות באוצר החכמה. ראשי תיבות, מספרים ומילים עם אותיות שימוש (ו, ה, ב, כ, ל, מ, ש) מזוהים. תיקון חל על המילה בכל הספר, ואפשר לבטל עם ↶.</small>
  </div><footer><button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
  D2.querySelector("#bkCancel").addEventListener("click", closeModal);
  D2.querySelectorAll("[data-sp-go]").forEach(b => b.addEventListener("click", () => {
    const x = shown[Number(b.dataset.spGo)][1]; closeModal(); goToLine(x.sec.id, x.ln, x.at, x.len);
  }));
  D2.querySelectorAll("[data-sp-fix]").forEach(b => b.addEventListener("click", () => {
    const w = shown[Number(b.dataset.spFix)][0];
    const n = replaceWord(w, b.dataset.to);
    markDirty(); renderSections(); scheduleLayout(0);
    b.closest(".bk-item").remove();
    toast("✓ «" + w + "» ← «" + b.dataset.to + "» (" + n + " מקומות, אפשר לבטל עם ↶)", "ok");
  }));
  D2.querySelectorAll("[data-sp-ok]").forEach(b => b.addEventListener("click", () => {
    const w = shown[Number(b.dataset.spOk)][0];
    const ok = spellOk(); ok.add(w); lsSet("bk_spell_ok", JSON.stringify([...ok]));
    b.closest(".bk-item").remove();
    toast("«" + w + "» נשמרה כמילה נכונה", "ok");
  }));
}

/* ------------------------------------------------------------- הכתבה (C3) */
// Eli's list (11-01) C3: Abba speaks, the words go into the text where the cursor is. The recording
// goes from this computer to Eli's server (the same one the chat uses), which turns Hebrew speech
// into text (Whisper) and sends the text back. The button shows only when the server can do it.
let DICT = {ready:null, rec:null, chunks:[], stream:null, ta:null, at:0, t0:0, timer:null};
async function dictateReady(){
  if(DICT.ready !== null) return DICT.ready;
  try{ DICT.ready = !!(await call("/api/stt/ready")).ok; }catch(e){ DICT.ready = false; }
  return DICT.ready;
}
async function dictateToggle(btn){
  if(DICT.rec){ DICT.rec.stop(); return; }
  const card = btn.closest(".bk-sec"), ta = card && card.querySelector("textarea");
  if(!ta) return;
  try{ DICT.stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true}}); }
  catch(e){ toast("אין גישה למיקרופון: " + (e.message || e.name), "err"); return; }
  DICT.ta = ta; DICT.at = ta.selectionStart; DICT.chunks = [];
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
  DICT.rec = new MediaRecorder(DICT.stream, mime ? {mimeType:mime, audioBitsPerSecond:32000} : {});
  DICT.rec.ondataavailable = e => { if(e.data && e.data.size) DICT.chunks.push(e.data); };
  DICT.rec.onstop = () => dictateDone(btn);
  DICT.rec.start(1000);
  DICT.t0 = Date.now();
  btn.classList.add("rec"); btn.innerHTML = "⏹ סיים הכתבה <span class=\"bk-dsec\">0:00</span>";
  DICT.timer = setInterval(() => {
    const s = Math.floor((Date.now() - DICT.t0) / 1000);
    const el = btn.querySelector(".bk-dsec"); if(el) el.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    if(s >= 300) DICT.rec && DICT.rec.state === "recording" && DICT.rec.stop();   // five minutes at most
  }, 500);
}
async function dictateDone(btn){
  clearInterval(DICT.timer);
  if(DICT.stream) DICT.stream.getTracks().forEach(t => t.stop());
  btn.classList.remove("rec"); btn.innerHTML = "🎤 הכתבה";
  const blob = new Blob(DICT.chunks, {type: DICT.rec.mimeType || "audio/webm"});
  DICT.rec = null;
  if(blob.size < 2000){ toast("ההקלטה קצרה מדי", "warn"); return; }
  btn.disabled = true; btn.textContent = "⏳ מתמלל…";
  try{
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(blob); });
    const res = await postJSON("/api/stt", {audio: b64, mime: blob.type});
    const text = String(res.text || "").trim();
    if(!text){ toast("לא נשמעו מילים בהקלטה", "warn"); return; }
    const ta = DICT.ta, at = Math.min(DICT.at, ta.value.length);
    const sp = at && !/\s$/.test(ta.value.slice(0, at)) ? " " : "";
    ta.focus(); ta.setRangeText(sp + text, at, at, "end"); fireInput(ta);
    toast("✓ נוספו " + text.split(/\s+/).length + " מילים מההכתבה (אפשר לבטל עם ↶)", "ok");
  }catch(e){ toast("ההכתבה לא הצליחה: " + (e.message || e), "err"); }
  finally{ btn.disabled = false; btn.innerHTML = "🎤 הכתבה"; }
}

function showTools(){
  const D = modal(`<header><h3>🧰 כלים לכל הספר</h3></header>
  <div class="bk-dbody"><div class="bk-choices">
    <button class="bk-choice" type="button" data-tool="find"><b>🔍 חיפוש והחלפה</b><small>בכל הספר בבת אחת (Ctrl+H)</small></button>
    <button class="bk-choice" type="button" data-tool="brackets"><b>( ) בדיקת סוגריים</b><small>מוצא סוגריים והערות שנפתחו ולא נסגרו</small></button>
    <button class="bk-choice" type="button" data-tool="spell"><b>🔤 בדיקת איות</b><small>לפי מילון של ספרי הקודש (200,000 מילים מאוצר החכמה)</small></button>
    <button class="bk-choice" type="button" data-tool="sources"><b>📚 בדיקת מראי מקומות</b><small>דף או פרק שלא קיים, וספר שנכתב בכמה צורות</small></button>
    <button class="bk-choice" type="button" data-tool="abbr"><b>✍ איחוד ראשי תיבות</b><small>אכמ"ל / ואין כאן מקום להאריך — צורה אחת בכל הספר</small></button>
    <button class="bk-choice" type="button" data-tool="docx"><b>📝 שמור כקובץ Word</b><small>כל הספר, עם הכותרות וההערות בתחתית העמוד</small></button>
    <button class="bk-choice" type="button" data-tool="tonotes"><b>[ ] ← הערות</b><small>כל טקסט בסוגריים מרובעים יהפוך להערה בתחתית העמוד</small></button>
    <button class="bk-choice" type="button" data-tool="nikud"><b>הסר ניקוד</b><small>מכל הטקסט בספר (אפשר לבטל)</small></button>
    <button class="bk-choice" type="button" data-tool="teamim"><b>הסר טעמים</b><small>מכל הטקסט בספר (אפשר לבטל)</small></button>
    <button class="bk-choice" type="button" data-tool="unadj"><b>↺ בטל כל הצמצומים</b><small>כל הפסקאות חוזרות לריווח הרגיל</small></button>
  </div></div>
  <footer><button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.tool;
    if(k === "find"){ findDialog(true); return; }
    if(k === "brackets"){ checkBrackets(); return; }
    if(k === "sources"){ checkSources(); return; }
    if(k === "spell"){ checkSpelling(); return; }
    if(k === "abbr"){ checkAbbr(); return; }
    if(k === "docx"){ closeModal(); exportDocx(); return; }
    closeModal();
    if(k === "tonotes"){
      let n = 0;
      for(const sec of book.sections) sec.text = sec.text.replace(/\[([^\[\]{}\n]{1,600})\]/g, (m, t) => { n++; return "{" + t.trim() + "}"; });
      if(n){ markDirty(); renderSections(); scheduleLayout(0); }
      toast(n ? "✓ " + n + " קטעים בסוגריים הפכו להערות (אפשר לבטל עם ↶)" : "לא נמצא טקסט בסוגריים מרובעים", n ? "ok" : "warn");
    }else if(k === "nikud" || k === "teamim"){
      const re = k === "nikud" ? /[\u05B0-\u05BC\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g : /[\u0591-\u05AF\u05BD]/g;
      let n = 0;
      for(const sec of book.sections){ const before = sec.text.length; sec.text = sec.text.replace(re, ""); n += before - sec.text.length; }
      if(n){ markDirty(); renderSections(); scheduleLayout(0); }
      toast(n ? "✓ הוסרו " + n + " סימנים (אפשר לבטל עם ↶)" : "לא נמצאו סימנים להסרה", n ? "ok" : "warn");
    }else if(k === "unadj"){
      for(const sec of book.sections) delete sec.adj;
      markDirty(); scheduleLayout(0); toast("✓ כל הפסקאות חזרו לרגיל", "ok");
    }
  }));
}
function bracketIssues(){
  const issues = [];
  for(const sec of book.sections){
    sec.text.split("\n").forEach((line, ln) => {
      const stack = [];
      const pairs = {")":"(", "]":"[", "}":"{"};
      for(const ch of line){
        if(ch === "(" || ch === "[" || ch === "{") stack.push(ch);
        else if(pairs[ch]){ if(stack.length && stack[stack.length - 1] === pairs[ch]) stack.pop(); else { stack.push("!" + ch); break; } }
      }
      if(stack.length) issues.push({sec, ln, line});
    });
  }
  return issues;
}
// shown by itself above the book whenever a bracket or a note was left open: a "{" without
// its "}" prints as plain text, and that would otherwise be found only at the printer
function syncBracketWarn(){
  const w = $("bkBrWarn");
  if(!w || !book) return;
  const n = bracketIssues().length;
  w.hidden = !n;
  w.textContent = "⚠ " + (n === 1 ? "סוגר אחד לא נסגר" : n + " סוגריים לא נסגרו");
}
function checkBrackets(){
  const issues = bracketIssues();
  const rows = issues.slice(0, 80).map((x, i) => `<div class="bk-item"><span class="bk-grow"><b>${esc(x.sec.title || KIND_LABEL[x.sec.kind])} · שורה ${x.ln + 1}</b><small>${esc(x.line.slice(0, 120))}</small></span><button class="bk-btn bk-small bk-soft" type="button" data-iss="${i}">פתח</button></div>`).join("");
  const D = modal(`<header><h3>( ) בדיקת סוגריים</h3></header><div class="bk-dbody">
    <div>${issues.length ? "נמצאו " + issues.length + " שורות שבהן סוגר או הערה נפתחו ולא נסגרו (או להפך):" : "✓ כל הסוגריים וההערות בספר סגורים כראוי."}</div>
    <div class="bk-list">${rows}</div></div><footer><button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelectorAll("[data-iss]").forEach(b => b.addEventListener("click", () => {
    const x = issues[Number(b.dataset.iss)];
    closeModal(); goToLine(x.sec.id, x.ln, 0, 0);
  }));
}
function goToLine(secId, ln, from, len){
  setTab("content");
  openSec = secId;
  renderSections();
  const card = ROOT.querySelector(".bk-sec[data-id=\"" + secId + "\"]");
  if(!card) return;
  card.scrollIntoView({block:"nearest"});
  const ta = card.querySelector("textarea");
  if(!ta) return;
  const lines = ta.value.split("\n");
  let off = 0;
  for(let i = 0; i < ln && i < lines.length; i++) off += lines[i].length + 1;
  ta.focus({preventScroll:true});
  // a found word / mark is selected (so it shows); "the place" alone (len 0) = just the cursor, never a whole line
  ta.setSelectionRange(off + from, off + from + (len || 0));
  ta.scrollTop = Math.max(0, ln / Math.max(1, lines.length) * ta.scrollHeight - 60);
  { const card2 = ta.closest(".bk-sec"); const sec2 = card2 && book.sections.find(x => x.id === card2.dataset.id); if(sec2) markHere(sec2.id, ln); }
}
let findState = {q:"", r:"", whole:false, nonik:true, pos:null};
function findRegex(q, whole, nonik){
  // " and ״ (and ' and ׳) count as the same mark: Abba types " and the book prints ״.
  // Any run of spaces matches any run of spaces.
  let pat = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/["״”“]/g, "\u0001").replace(/['׳’‘]/g, "\u0002").replace(/\s+/g, "\u0003");
  if(nonik) pat = pat.split("").map(ch => /[א-ת]/.test(ch) ? ch + "[\\u0591-\\u05C7]*" : ch).join("");
  pat = pat.replace(/\u0001/g, "[\"״”“]").replace(/\u0002/g, "['׳’‘]").replace(/\u0003/g, "\\s+");
  if(whole) pat = "(?<![א-ת\\w])" + pat + "(?![א-ת\\w])";
  return new RegExp(pat, "g");
}
function findDialog(withReplace){
  const D = modal(`<header><h3>🔍 חיפוש${withReplace ? " והחלפה" : ""}</h3></header>
  <div class="bk-dbody">
    <label class="bk-field">מה לחפש<input class="bk-input" id="bkFindQ" value="${esc(findState.q)}"/></label>
    <label class="bk-field">להחליף ב־ (לא חובה)<input class="bk-input" id="bkFindR" value="${esc(findState.r)}"/></label>
    <label class="bk-check"><input type="checkbox" id="bkFindWhole"${findState.whole ? " checked" : ""}/><span>מילה שלמה בלבד</span></label>
    <label class="bk-check"><input type="checkbox" id="bkFindNik"${findState.nonik ? " checked" : ""}/><span>להתעלם מניקוד וטעמים</span></label>
    <div id="bkFindInfo" class="bk-hint"></div>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkFindNext">🔍 מצא הבא</button>
  <button class="bk-btn" type="button" id="bkRepOne">החלף את זה</button>
  <button class="bk-btn" type="button" id="bkRepAll">החלף הכל</button>
  <button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
  const q = D.querySelector("#bkFindQ"), r = D.querySelector("#bkFindR"), info = D.querySelector("#bkFindInfo");
  const read = () => { findState.q = q.value; findState.r = r.value; findState.whole = D.querySelector("#bkFindWhole").checked; findState.nonik = D.querySelector("#bkFindNik").checked; };
  const all = () => {
    read();
    if(!findState.q) return [];
    const re = findRegex(findState.q, findState.whole, findState.nonik);
    const hits = [];
    book.sections.forEach((sec) => sec.text.split("\n").forEach((line, ln) => {
      re.lastIndex = 0; let m;
      while((m = re.exec(line))){ hits.push({sec: sec.id, ln, from: m.index, len: m[0].length}); if(!m[0].length) re.lastIndex++; }
    }));
    return hits;
  };
  const next = () => {
    const hits = all();
    if(!hits.length){ info.textContent = "לא נמצא"; return null; }
    let i = 0;
    if(findState.pos){
      const k = (x) => book.sections.findIndex(s => s.id === x.sec) * 1e9 + x.ln * 1e5 + x.from;
      const cur = k(findState.pos);
      i = hits.findIndex(x => k(x) > cur);
      if(i < 0) i = 0;
    }
    findState.pos = hits[i];
    info.textContent = "נמצאו " + hits.length + " מקומות · זה מספר " + (i + 1);
    goToLine(hits[i].sec, hits[i].ln, hits[i].from, hits[i].len);
    return hits[i];
  };
  D.querySelector("#bkFindNext").addEventListener("click", next);
  q.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); next(); } });
  D.querySelector("#bkRepOne").addEventListener("click", () => {
    read();
    const x = findState.pos;
    if(!x){ next(); return; }
    const sec = book.sections.find(s => s.id === x.sec);
    const lines = sec.text.split("\n");
    lines[x.ln] = lines[x.ln].slice(0, x.from) + findState.r + lines[x.ln].slice(x.from + x.len);
    sec.text = lines.join("\n");
    findState.pos = {sec: x.sec, ln: x.ln, from: x.from + findState.r.length - 1, len: 0};
    markDirty(); renderSections(); scheduleLayout();
    next();
  });
  D.querySelector("#bkRepAll").addEventListener("click", () => {
    read();
    if(!findState.q) return;
    const re = findRegex(findState.q, findState.whole, findState.nonik);
    let n = 0;
    for(const sec of book.sections) sec.text = sec.text.replace(re, () => { n++; return findState.r; });
    if(n){ markDirty(); renderSections(); scheduleLayout(0); }
    info.textContent = n ? "✓ הוחלפו " + n + " מקומות (אפשר לבטל עם ↶)" : "לא נמצא";
  });
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  if(!withReplace){ D.querySelector("#bkRepOne").hidden = true; D.querySelector("#bkRepAll").hidden = true; }
}

/* ------------------------------------------------------------- versions */
async function showVersions(){
  if(!book) return;
  await saveNow();
  progressBox("טוען גרסאות קודמות…");
  let list = [];
  try{ list = (await call("/api/book/versions?id=" + encodeURIComponent(book.id))).versions || []; }
  catch(e){ closeModal(); toast(e.message || String(e), "err"); return; }
  const fmt = (t) => { try{ return new Date(t * 1000).toLocaleString("he-IL", {dateStyle:"short", timeStyle:"short"}); }catch(e){ return ""; } };
  const rows = list.map(v => `<div class="bk-item"><span class="bk-grow"><b>🕘 ${esc(fmt(v.time))}</b>
    <small>${v.sections} קטעים${v.pages ? " · " + v.pages + " עמודים" : ""}</small></span>
    <button class="bk-btn bk-small bk-primary" type="button" data-ver="${esc(v.v)}" data-only="design">🎨 החזר את העיצוב</button>
    <button class="bk-btn bk-small" type="button" data-ver="${esc(v.v)}" data-only="all">החזר הכל</button></div>`).join("");
  const D = modal(`<header><h3>🕘 גרסאות קודמות של הספר</h3></header><div class="bk-dbody">
    <div>התוכנה שומרת לבד עותק של הספר כל עשר דקות של עבודה.</div>
    <div><b>🎨 החזר את העיצוב</b> — הספר יקבל את העיצוב שהיה אז (גופנים, כותרות, שוליים). <b>הטקסט שכתבתם נשאר כמו שהוא.</b></div>
    <div><b>החזר הכל</b> — גם הטקסט יחזור למה שהיה אז, ומה שנכתב מאז יימחק מהספר.</div>
    <div>בכל מקרה אפשר ללחוץ "↶ בטל" ולחזור למה שהיה לפני.</div>
    <div class="bk-list">${rows || "<div>עדיין אין גרסאות קודמות — הן נשמרות לבד תוך כדי עבודה.</div>"}</div></div>
    <footer><button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  const restore = async (v, only) => {
    try{
      const res = await call("/api/book/version?id=" + encodeURIComponent(book.id) + "&v=" + encodeURIComponent(v));
      histCapture();
      if(only === "design"){
        // only the look comes back; the text, titles and notes stay exactly as they are now
        book.style = normalize(res.book).style; st = book.style;
      }else{
        const keep = book.id;
        book = normalize(res.book); book.id = keep; st = book.style; openSec = null;
      }
      rerenderAll(); markDirty(); scheduleLayout(0); histCapture();
      closeModal();
      toast(only === "design" ? "✓ העיצוב הוחזר — הטקסט לא השתנה. לא מתאים? ↶ בטל" : "✓ הגרסה שוחזרה — אם זה לא מה שרציתם, לחצו ↶ בטל", "ok");
    }catch(e){ toast(e.message || String(e), "err"); }
  };
  D.querySelectorAll("[data-ver]").forEach(b => b.addEventListener("click", () => {
    if(b.dataset.only === "design"){ restore(b.dataset.ver, "design"); return; }
    confirmBox("להחזיר את כל הספר?", "גם הטקסט יחזור למה שהיה בגרסה הזאת, ומה שנכתב מאז יימחק מהספר. (אפשר לבטל עם ↶)",
      "כן, החזר הכל", () => restore(b.dataset.ver, "all"));
  }));
}

/* --------------------------------------------------------------- modals */
function modal(html, cls){
  runModalClose();
  modalRefresh = null;
  const M = $("bkModal"), D = $("bkDialog");
  D.className = "bk-dialog" + (cls ? " " + cls : "");
  D.innerHTML = html;
  M.hidden = false;
  setTimeout(() => trail("open"), 0);
  const first = D.querySelector("textarea,input,button.bk-primary,button");
  if(first) setTimeout(() => first.focus(), 30);
  return D;
}
// a dialog that holds something open (the microphone) lets go of it on every way out
let onModalClose = null;
function runModalClose(){
  const f = onModalClose;
  onModalClose = null;
  if(f){ try{ f(); }catch(e){} }
}
function closeModal(){ runModalClose();
  if(!$("bkModal").hidden){
    // what the שער looks like when he leaves the window, so we can tell what he ended up with
    let tp = "";
    try{ const t = book && book.style && book.style.tp; if(t) tp = (t.mode || "lines") + " · " + (t.preset || "") + " · " + ((t.items || t.lines || []).length) + " חלקים"; }catch(e){}
    trail("close", tp ? {tp} : null); trailFlush();
  }
  $("bkModal").hidden = true; $("bkDialog").innerHTML = "";
}
function confirmBox(title, text, okLabel, onOk){
  const D = modal(`<header><h3>${esc(title)}</h3></header><div class="bk-dbody"><div>${text}</div></div>
  <footer><button class="bk-btn bk-danger" type="button" id="bkOk">${okLabel}</button><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
  D.querySelector("#bkOk").addEventListener("click", () => { closeModal(); onOk(); });
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
}
// "📖 כאן מתחיל דף חדש": the text after the cursor becomes its own part, with no heading
// of its own, on the daf chosen here (offered: the amud after the current one)
function newDafDialog(sec, idx, ta){
  const pos = ta.selectionStart || 0;
  if(!sec.text.slice(pos).trim()){ toast("שימו את הסמן בטקסט, במקום שבו מתחיל הדף החדש", "warn"); return; }
  let cur = null;
  for(let i = 0; i <= idx; i++){ const s = book.sections[i]; if(parseInt(s.daf, 10)) cur = s; }
  const cd = cur ? parseInt(cur.daf, 10) : 0;
  const next = !cd ? {daf:2, amud:"א"} : cur.amud === "א" ? {daf:cd, amud:"ב"} : {daf:cd + 1, amud:"א"};
  let opts = "";
  for(let i = 2; i <= 176; i++) opts += `<option value="${i}"${i === next.daf ? " selected" : ""}>${gem(i)}</option>`;
  const am = [["א", "ע״א ( . )"], ["ב", "ע״ב ( : )"], ["", "בלי עמוד"]]
    .map(([v, l]) => `<option value="${v}"${next.amud === v ? " selected" : ""}>${l}</option>`).join("");
  const D = modal(`<header><h3>📖 כאן מתחיל דף חדש</h3></header>
  <div class="bk-dbody">
    <div>${cur ? "עכשיו: <b>" + esc(dafLabel(cur, st.dafFormat)) + "</b>. " : ""}מאיזה דף מתחיל הטקסט שאחרי הסמן?</div>
    <div class="bk-row" style="margin-top:10px">
      <label class="bk-field">דף<select class="bk-select" id="bkNdDaf">${opts}</select></label>
      <label class="bk-field">עמוד<select class="bk-select" id="bkNdAmud">${am}</select></label>
    </div>
    <div class="bk-hint bk-keep">במקום הזה יודפס שם הדף ככותרת קטנה, והטקסט ממשיך בלי כותרת אחרת. בספר זה נראה רציף.</div>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkOk">התחל כאן את הדף</button><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelector("#bkOk").addEventListener("click", () => {
    const daf = parseInt(D.querySelector("#bkNdDaf").value, 10), amud = D.querySelector("#bkNdAmud").value;
    closeModal();
    const before = sec.text.slice(0, pos).replace(/\s+$/, ""), after = sec.text.slice(pos).replace(/^\s+/, "");
    const ns = {id:uid("s"), kind:"text", title:"", text:after, daf, amud};
    if(before) { sec.text = before; book.sections.splice(idx + 1, 0, ns); }
    else { sec.daf = daf; sec.amud = amud; }   // the cursor was at the very start: this part is the new daf
    markDirty(); renderSections(); openSection(before ? ns.id : sec.id, false); scheduleLayout(200);
    toast("✓ מכאן מתחיל " + dafLabel(before ? ns : sec, st.dafFormat) + " — אפשר לבטל עם ↶", "ok");
  });
}
/* ------------------------------------------------ "🎨 עיצוב שער הספר" */
// Every line of the שער with its own look, ready designs to start from, and the page itself
// beside it, changing as you go. Opened from the design tab or by clicking the שער in the book.
function tpEnsure(){
  if(!st.tp || !Array.isArray(st.tp.lines)) st.tp = JSON.parse(JSON.stringify(tpOf(st)));
  return st.tp;
}
/* ---- "סטודיו שער הספר": the whole שער in its own full-screen wizard, apart from the עימוד ---- */
const TP_WIZ = [["pick", "① בוחרים שער"], ["words", "② משנים את הכתוב"], ["free", "③ עיצוב חופשי"], ["done", "④ סיום — חזרה לספר"]];
const tpWizBar = (on) => `<nav class="bk-wiz" aria-label="שלבי עיצוב השער">${TP_WIZ.map(([k, l]) =>
  `<button type="button" class="bk-wizstep${k === on ? " on" : ""}" data-wiz="${k}"${k === on ? " aria-current=\"step\"" : ""}>${l}</button>`).join("")}</nav>`;
function tpWizGo(k){
  if(k === "done"){ closeModal(); return; }
  if(k === "pick"){ tpHub(); return; }
  if(k === "free"){ tpStudio(); return; }
  tpWords();
}
const tpWizWire = (D) => D.querySelectorAll("[data-wiz]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); tpWizGo(b.dataset.wiz); }));
/* ---- step ② of the שער studio: just the words, as a plain form, whatever the שער is ---- */
// Abba: "משנים את הכתוב" must simply let him type. The book's own fields first, then every other
// line that stands on the שער (lines-mode free lines, or the text boxes of a free שער).
function tpWords(){
  tpEnsure();
  const D = modal(`<header><h3>🎨 סטודיו שער הספר</h3>${tpWizBar("words")}<span class="bk-hist"><button type="button" class="bk-btn" data-hist="undo" title="ביטול (Ctrl+Z)">↶ בטל</button><button type="button" class="bk-btn" data-hist="redo" title="החזרה (Ctrl+Y)">↷ החזר</button></span></header>
  <div class="bk-dbody bk-hubwrap">
    <div class="bk-hubside"><div class="bk-tpbox" id="bkWdPrev"></div><small>כל מה שכותבים מופיע מיד בשער</small></div>
    <div class="bk-wdform" id="bkWdForm"></div>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" data-wiz="done">✔ סיום — חזרה לספר</button>
    <button class="bk-btn" type="button" id="bkWdMore">🔤 גופן, גודל וקישוטים של כל שורה…</button></footer>`, "bk-tpdlg bk-hubdlg bk-tpwin");
  tpWizWire(D);
  const g = geometry(st), T = () => st.tp;
  const preview = () => {
    const box = D.querySelector("#bkWdPrev");
    const P = titlePages(book, st, $("bkMeasure"))[0];
    const w = Math.max(220, Math.min(330, window.innerWidth - 60)), k = w / (g.W * MM);
    box.innerHTML = "";
    box.style.width = w + "px"; box.style.height = (g.H * MM * k) + "px";
    P.el.style.transform = "scale(" + k + ")";
    box.appendChild(P.el);
  };
  const extra = () => T().mode === "free"
    ? (T().items || []).filter(x => x.t === "txt" && !x.bind && /[\u0590-\u05FFA-Za-z0-9]/.test(String(x.text || ""))).map(x => ({id:x.id, text:x.text || ""}))
    : (T().lines || []).map((L, i) => ({i, L})).filter(o => o.L.k === "pre" || o.L.k === "free").map(o => ({i:o.i, text:o.L.text || ""}));
  const form = () => {
    const f = (key, label, ph, multi) => `<label class="bk-wdf"><b>${label}</b>${multi
      ? `<textarea class="bk-input" rows="2" data-wb="${key}" placeholder="${ph}">${esc(book[key] || "")}</textarea>`
      : `<input class="bk-input" data-wb="${key}" value="${esc(book[key] || "")}" placeholder="${ph}"/>`}</label>`;
    const ex = extra();
    D.querySelector("#bkWdForm").innerHTML = `<h4 class="bk-tph">✍ הכתוב בשער</h4>
      ${f("title", "שם הספר", "למשל: עושה חיל")}
      ${f("subtitle", "תת־כותרת", "למשל: חידושים על מסכת מכות", true)}
      ${f("author", "המחבר", "למשל: הרב …", true)}
      <div class="bk-two">${f("place", "מקום", "למשל: ירושלים")}${f("year", "שנה", "למשל: תשפ״ז")}</div>
      ${ex.length ? `<h4 class="bk-tph">📝 שורות נוספות בשער</h4>` + ex.map(o =>
        `<label class="bk-wdf"><b>שורה</b><input class="bk-input" ${o.id ? `data-wid="${esc(o.id)}"` : `data-wl="${o.i}"`} value="${esc(o.text)}"/></label>`).join("") : ""}
      <small class="bk-tpnote">שם הספר, המחבר והשנה הם אותם פרטים כמו בלשונית "פרטי הספר".</small>`;
  };
  form(); preview();
  modalRefresh = () => { tpEnsure(); form(); preview(); };
  D.querySelector("[data-hist=undo]").addEventListener("click", undo);
  D.querySelector("[data-hist=redo]").addEventListener("click", redo);
  D.querySelector("#bkWdMore").addEventListener("click", () => { if(T().mode === "free") tpStudio(); else tpDesigner(); });
  D.addEventListener("input", e => {
    const s = e.target;
    if(s.dataset.wb){ book[s.dataset.wb] = s.value; if(s.dataset.wb === "title") renderTop(); }
    else if(s.dataset.wid){ const it = (T().items || []).find(x => x.id === s.dataset.wid); if(it) it.text = s.value; }
    else if(s.dataset.wl != null){ const L = T().lines[Number(s.dataset.wl)]; if(L) L.text = s.value; }
    else return;
    markDirty(); scheduleLayout(300); preview();
  });
}
/* -------------------------------------- "🎨 שער הספר" — one clear page for the whole שער */
// Abba found the two buttons confusing. Here: all the ready שערים big, in front of the eyes,
// the current שער large beside them, and two plainly-explained ways to go on changing it.
function tpHub(){
  tpEnsure();
  const D = modal(`<header><h3>🎨 סטודיו שער הספר</h3>${tpWizBar("pick")}<span class="bk-hist"><button type="button" class="bk-btn" data-hist="undo" title="ביטול הפעולה האחרונה (Ctrl+Z)">↶ בטל</button><button type="button" class="bk-btn" data-hist="redo" title="החזרה (Ctrl+Y)">↷ החזר</button></span></header>
  <div class="bk-dbody bk-hubwrap">
    <div class="bk-hubside">
      <div class="bk-tpbox" id="bkHubPrev"></div>
      <small>זה השער של הספר עכשיו</small>
      <div class="bk-hubways">
        <div class="bk-hubstep"><b>שלב 1 · בוחרים שער</b><span>לוחצים על אחת הדוגמאות. זה כל מה שצריך. אפשר להתחרט: ↶</span></div>
        <button type="button" class="bk-btn bk-hubgo" id="bkHubLines"><b>✍ שלב 2 · לשנות את הכתוב</b>
          <span>כותבים את שם הספר, המחבר, המקום והשנה — וכל שורה אחרת שבשער. רואים את השער מתעדכן מיד.</span></button>
        <button type="button" class="bk-btn bk-hubgo" id="bkHubFree"><b>🖌 לעיצוב חופשי (למתקדמים)</b>
          <span>כמו בתוכנת ציור: גוררים כל דבר לכל מקום, מוסיפים תמונות, צורות וקישוטים.</span></button>
      </div>
    </div>
    <div class="bk-hubgal" id="bkHubGal"></div>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkCancel">סיום</button></footer>`, "bk-tpdlg bk-hubdlg bk-tpwin");
  tpWizWire(D);
  const g = geometry(st);
  const preview = () => {
    const box = D.querySelector("#bkHubPrev");
    const P = titlePages(book, st, $("bkMeasure"))[0];
    const w = Math.max(220, Math.min(330, window.innerWidth - 60)), k = w / (g.W * MM);
    box.innerHTML = "";
    box.style.width = w + "px"; box.style.height = (g.H * MM * k) + "px";
    P.el.style.transform = "scale(" + k + ")";
    box.appendChild(P.el);
  };
  const groups = [["✨ שערים מפוארים — בסגנון ספרי אוצר החכמה", p => /^r_/.test(p.k)], ["📄 שערים פשוטים ונקיים", p => !/^r_/.test(p.k)]];
  const gallery = () => {
    const G = D.querySelector("#bkHubGal"), cur = st.tp && st.tp.preset;
    G.innerHTML = groups.map(([t, f]) => `<h4 class="bk-tph">${t}</h4><div class="bk-hubgrid">`
      + TP_PRESETS.filter(f).map(p => `<button type="button" class="bk-tpcard${cur === p.k ? " on" : ""}" data-hubp="${p.k}"><span class="bk-tpthumb"></span><b>${p.name}</b></button>`).join("")
      + "</div>").join("");
    const k = 150 / (g.W * MM);
    G.querySelectorAll("[data-hubp]").forEach(b => {
      const th = b.querySelector(".bk-tpthumb");
      th.style.width = "150px"; th.style.height = (g.H * MM * k) + "px";
      const el = h("div", {class:"bk-page odd k-title"}, tpHTML(book, st, tpFromPreset(b.dataset.hubp, null, g)));
      el.style.transform = "scale(" + k + ")";
      th.appendChild(el);
    });
  };
  gallery(); preview();
  modalRefresh = () => { gallery(); preview(); };
  D.querySelector("[data-hist=undo]").addEventListener("click", undo);
  D.querySelector("[data-hist=redo]").addEventListener("click", redo);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  // never replace the שער that was chosen: one designed freely (every fancy שער is) has its
  // words changed right on the page, in the studio
  D.querySelector("#bkHubLines").addEventListener("click", () => { tpWords(); });
  D.querySelector("#bkHubFree").addEventListener("click", () => { tpStudio(); });
  D.addEventListener("click", e => {
    const b = e.target.closest("[data-hubp]");
    if(!b) return;
    const t = tpFromPreset(b.dataset.hubp, null, g);
    st.tp = t.mode === "free" ? t : Object.assign(t, st.tp && st.tp.items ? {items:st.tp.items, bg:st.tp.bg} : {});
    markDirty(); scheduleLayout(300);
    D.querySelectorAll(".bk-tpcard.on").forEach(x => x.classList.remove("on")); b.classList.add("on");
    preview();
    toast("נבחר השער «" + (TP_PRESETS.find(p => p.k === b.dataset.hubp) || {}).name + "» — אפשר לבטל עם ↶", "ok");
  });
}
function tpDesigner(){
  tpEnsure();
  const D = modal(`<header><h3>🎨 סטודיו שער הספר</h3>${tpWizBar("words")}<span class="bk-hist"><button type="button" class="bk-btn" data-hist="undo" title="ביטול הפעולה האחרונה (Ctrl+Z)">↶ בטל</button><button type="button" class="bk-btn" data-hist="redo" title="החזרה (Ctrl+Y)">↷ החזר</button></span></header>
  <div class="bk-dbody bk-tpwrap">
    <div class="bk-tpctl">
      <div class="bk-hint bk-keep">בוחרים עיצוב מוכן, ואז משנים כל שורה כרצונכם: גופן, גודל, הדגשה, מרווח, אותיות חלולות, ומקום בדף.
        אפשר להוסיף שורות משלכם (למשל "בעזרת השם") וקישוטים. כל שינוי נראה מיד בשער שמשמאל.</div>
      <button type="button" class="bk-btn bk-stgo" id="bkTpStudio">🖌 סטודיו — עיצוב חופשי: להזיז כל דבר לכל מקום, תמונות, צורות, צבעים</button>
      <h4 class="bk-tph">✨ עיצובים מוכנים</h4>
      <div class="bk-tpgal" id="bkTpGal"></div>
      <h4 class="bk-tph">🖼 המסגרת</h4>
      <div class="bk-pills" id="bkTpFrames"></div>
      <label class="bk-field">הגופן של כל השער<select class="bk-select" id="bkTpFont"></select></label>
      <h4 class="bk-tph">📝 השורות שבשער, מלמעלה למטה</h4>
      <div id="bkTpRows"></div>
      <div class="bk-tpadd">
        <button class="bk-btn" type="button" data-tpadd="free">＋ שורה חופשית</button>
        <button class="bk-btn" type="button" data-tpadd="orn">＋ קישוט</button>
        <span id="bkTpAddMore"></span>
      </div>
    </div>
    <div class="bk-tpprev"><div class="bk-tpbox" id="bkTpPrev"></div><small>כך ייראה השער בספר. הכל נשמר לבד.</small></div>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkCancel">סיום</button></footer>`, "bk-tpdlg bk-tpwin");
  tpWizWire(D);
  const tp = () => st.tp;
  const preview = () => {
    const box = D.querySelector("#bkTpPrev");
    const P = titlePages(book, st, $("bkMeasure"))[0];
    const g = geometry(st), w = Math.max(220, Math.min(380, window.innerWidth - 80)), k = w / (g.W * MM);
    box.innerHTML = "";
    box.style.width = w + "px"; box.style.height = (g.H * MM * k) + "px";
    P.el.style.transform = "scale(" + k + ")";
    box.appendChild(P.el);
  };
  const gallery = () => {
    const G = D.querySelector("#bkTpGal");
    G.innerHTML = TP_PRESETS.map(p => `<button type="button" class="bk-tpcard${tp().preset === p.k ? " on" : ""}" data-tpp="${p.k}">
      <span class="bk-tpthumb"></span><b>${p.name}</b></button>`).join("");
    const g = geometry(st), k = 96 / (g.W * MM);
    G.querySelectorAll("[data-tpp]").forEach(b => {
      const t = tpFromPreset(b.dataset.tpp, null, g);
      const th = b.querySelector(".bk-tpthumb");
      th.style.height = (g.H * MM * k) + "px";
      const el = h("div", {class:"bk-page odd k-title"}, tpHTML(book, st, t));
      el.style.transform = "scale(" + k + ")";
      th.appendChild(el);
    });
  };
  const frames = () => {
    D.querySelector("#bkTpFrames").innerHTML = TP_FRAMES.map(([v, l]) =>
      `<button type="button" class="bk-pill${tp().frame === v ? " on" : ""}" data-tpf="${v}">${l}</button>`).join("");
    D.querySelector("#bkTpFont").innerHTML = fontOptions(tp().font || "", "כמו הכותרות בספר");
  };
  const field = (L, i) => {
    if(L.k === "pre" || L.k === "free")
      return `<input class="bk-input" data-tpt="${i}" value="${esc(L.text)}" placeholder="${L.k === "pre" ? "למשל: ספר" : "למשל: בעזרת השם יתברך"}"/>`;
    if(L.k === "orn")
      return `<select class="bk-select" data-tpo="orn" data-i="${i}">${TP_ORNS.map(([v, l]) => `<option value="${v}"${(L.orn || "line") === v ? " selected" : ""}>${l}</option>`).join("")}</select>`;
    if(L.k === "place")
      return `<div class="bk-two"><input class="bk-input" data-tpb="place" value="${esc(book.place || "")}" placeholder="מקום, למשל: ירושלים"/>
        <input class="bk-input" data-tpb="year" value="${esc(book.year || "")}" placeholder="שנה, למשל: תשפ״ז"/></div>`;
    const f = {title:"title", sub:"subtitle", auth:"author"}[L.k];
    const multi = L.k !== "title";
    return (multi ? `<textarea class="bk-input" rows="2" data-tpb="${f}">` + esc(book[f] || "") + "</textarea>"
      : `<input class="bk-input" data-tpb="${f}" value="${esc(book[f] || "")}"/>`)
      + `<small class="bk-tpnote">אותו טקסט כמו בלשונית "פרטי הספר"</small>`;
  };
  const rows = () => {
    const T = tp(), n = T.lines.length;
    D.querySelector("#bkTpRows").innerHTML = T.lines.map((L, i) => {
      const orn = L.k === "orn";
      const lsSel = [[0, "רגיל"], [0.15, "מרווח"], [0.35, "מרווח מאוד"], [0.6, "מפוזר"]]
        .map(([v, l]) => `<option value="${v}"${Math.abs((Number(L.ls) || 0) - v) < 0.01 ? " selected" : ""}>${l}</option>`).join("");
      return `<div class="bk-tprow" data-i="${i}">
        <div class="bk-tprow-h"><b>${TP_KINDS[L.k] || L.k}</b>
          <span class="bk-tpbtns">
            <button type="button" class="bk-btn" data-tpm="-1" data-i="${i}" title="להעלות את השורה"${i ? "" : " disabled"}>▲</button>
            <button type="button" class="bk-btn" data-tpm="1" data-i="${i}" title="להוריד את השורה"${i < n - 1 ? "" : " disabled"}>▼</button>
            <button type="button" class="bk-btn bk-danger" data-tpdel="${i}" title="להוריד את השורה מהשער">🗑</button>
          </span></div>
        ${field(L, i)}
        <div class="bk-tprow-o">
          <label class="bk-field">גופן<select class="bk-select" data-tpo="font" data-i="${i}">${fontOptions(L.font || "", "כמו כל השער")}</select></label>
          <span class="bk-tpopt">גודל <span class="bk-step"><button type="button" data-tpsz="-1" data-i="${i}" aria-label="הקטן">−</button><span>${L.size} נק'</span><button type="button" data-tpsz="1" data-i="${i}" aria-label="הגדל">+</button></span></span>
          <span class="bk-tpopt">רווח מעל <span class="bk-step"><button type="button" data-tpgap="-2" data-i="${i}" aria-label="פחות רווח">−</button><span>${L.gap} מ"מ</span><button type="button" data-tpgap="2" data-i="${i}" aria-label="יותר רווח">+</button></span></span>
          ${orn ? "" : `<label class="bk-field">ריווח אותיות<select class="bk-select" data-tpo="ls" data-i="${i}">${lsSel}</select></label>
          <button type="button" class="bk-pill${L.bold ? " on" : ""}" data-tptog="bold" data-i="${i}"><b>ב</b> מודגש</button>
          <button type="button" class="bk-pill${L.look === "outline" ? " on" : ""}" data-tptog="look" data-i="${i}">אותיות חלולות</button>`}
          <button type="button" class="bk-pill${L.bottom ? " on" : ""}" data-tptog="bottom" data-i="${i}" title="השורה הזאת (ומה שאחריה) יורדת לתחתית השער">⤓ בתחתית הדף</button>
        </div></div>`;
    }).join("");
    const have = new Set(T.lines.map(L => L.k));
    D.querySelector("#bkTpAddMore").innerHTML = ["pre", "title", "sub", "auth", "place"].filter(k => !have.has(k))
      .map(k => `<button class="bk-btn" type="button" data-tpadd="${k}">＋ ${TP_KINDS[k]}</button>`).join("");
  };
  const all = () => { gallery(); frames(); rows(); preview(); };
  const changed = (redraw) => {
    tp().preset = "";                      // edited: no longer exactly one of the ready designs
    markDirty(); scheduleLayout(300);
    if(redraw) rows();
    D.querySelectorAll(".bk-tpcard.on").forEach(b => b.classList.toggle("on", false));
    preview();
  };
  all();
  modalRefresh = () => { tpEnsure(); all(); };
  D.querySelector("[data-hist=undo]").addEventListener("click", undo);
  D.querySelector("[data-hist=redo]").addEventListener("click", redo);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelector("#bkTpStudio").addEventListener("click", () => { tpStudio(); });
  D.addEventListener("click", e => {
    const b = e.target.closest("button");
    if(!b || !D.contains(b)) return;
    const T = tp(), i = Number(b.dataset.i);
    if(b.dataset.tpp){
      const t = tpFromPreset(b.dataset.tpp, null, geometry(st));
      st.tp = t.mode === "free" ? t : Object.assign(t, st.tp && st.tp.items ? {items:st.tp.items, bg:st.tp.bg} : {});
      markDirty(); scheduleLayout(300); all();
      toast("העיצוב «" + (TP_PRESETS.find(p => p.k === b.dataset.tpp) || {}).name + "» הוחל על השער — אפשר לבטל עם ↶", "ok");
      return;
    }
    if(b.dataset.tpf){ T.frame = b.dataset.tpf; frames(); changed(false); return; }
    if(b.dataset.tpadd){
      const k = b.dataset.tpadd;
      const L = tpL(k, {title:30, orn:12, auth:15}[k] || 13, {gap:6, text:k === "pre" ? "ספר" : "", bold:k === "title"});
      const at = T.lines.findIndex(x => x.bottom);
      if(k === "place") L.bottom = true;
      if(at >= 0 && k !== "place") T.lines.splice(at, 0, L); else T.lines.push(L);
      changed(true); return;
    }
    if(b.dataset.tpm){
      const j = i + Number(b.dataset.tpm);
      if(j < 0 || j >= T.lines.length) return;
      [T.lines[i], T.lines[j]] = [T.lines[j], T.lines[i]];
      changed(true); return;
    }
    if(b.dataset.tpdel){ T.lines.splice(Number(b.dataset.tpdel), 1); changed(true); return; }
    if(b.dataset.tpsz){ const L = T.lines[i]; L.size = Math.max(6, Math.min(80, (Number(L.size) || 12) + Number(b.dataset.tpsz))); changed(true); return; }
    if(b.dataset.tpgap){ const L = T.lines[i]; L.gap = Math.max(0, Math.min(90, (Number(L.gap) || 0) + Number(b.dataset.tpgap))); changed(true); return; }
    if(b.dataset.tptog){
      const L = T.lines[i], k = b.dataset.tptog;
      if(k === "look") L.look = L.look === "outline" ? "" : "outline"; else L[k] = !L[k];
      changed(true); return;
    }
  });
  D.addEventListener("change", e => {
    const s = e.target;
    if(s.id === "bkTpFont"){ tp().font = s.value; changed(false); return; }
    if(s.dataset.tpo){ const L = tp().lines[Number(s.dataset.i)]; L[s.dataset.tpo] = s.dataset.tpo === "ls" ? Number(s.value) : s.value; changed(false); }
  });
  D.addEventListener("input", e => {
    const s = e.target;
    if(s.dataset.tpt != null){ tp().lines[Number(s.dataset.tpt)].text = s.value; changed(false); return; }
    if(s.dataset.tpb){
      book[s.dataset.tpb] = s.value;
      if(s.dataset.tpb === "title") renderTop();
      markDirty(); scheduleLayout(300); preview();
    }
  });
}
/* ------------------------------------------------- "🖌 סטודיו" for the שער */
// The page itself, big, and everything on it can be picked up: drag to move, the corner
// squares to resize, the round handle to turn. Toolbar adds text, pictures, shapes, lines and
// ornaments; the side panel changes the picked item (or the page when nothing is picked).
const ST_DEF = {op:1, lh:1.25, sx:100, bri:100, con:100, pts:5, inner:0.45, shd:0.6, pad:2, bdw:0.8, sw:1};
const ST_GLYPHS = [...new Set(["❖", "★", "☆", "✦", "✧", "◆", "◇", "❦", "❧", "☙", "✡", "⚜", "❀", "✿", "•", "※", "۞", "⁂"].concat(TP_ORN_GLYPHS))];
function tpStudio(){
  if(!st.tp || st.tp.mode !== "free"){ st.tp = tpToFree(book, st); markDirty(); scheduleLayout(300); }
  const T = () => st.tp;
  const g = geometry(st), PW = g.W * MM, PH = g.H * MM;
  {
    const its = T().items || [], one = its.filter(x => x.art && !x.pname);
    if(T().recipe && one.length && one.every(x => !x.part || ["bg", "frame", "panel", "orn"].includes(x.part)) && (one.length === 1 || one.length <= 4)){
      const i = its.indexOf(one[0]);
      for(const x of one.slice(1)) its.splice(its.indexOf(x), 1);
      its.splice(i, 1, ...tpArtParts(T().recipe, g));
      markDirty(); scheduleLayout(300);
    }
  }
  let sel = null, k = 1, zoom = 1, grid = lsGet("bk_st_grid", "0") === "1";
  const undoStack = [], redoStack = [];
  const snap = () => { undoStack.push(JSON.stringify(T())); if(undoStack.length > 60) undoStack.shift(); redoStack.length = 0; };
  const D = modal(`<header><h3>🎨 סטודיו שער הספר</h3>${tpWizBar("free")}
    <button class="bk-btn" type="button" data-st="undo" title="בטל (Ctrl+Z)">↶ בטל</button>
    <button class="bk-btn" type="button" data-st="redo" title="החזר (Ctrl+Y)">↷ החזר</button></header>
  <div class="bk-stbar" role="toolbar" aria-label="הוספה">
    <button class="bk-btn" type="button" data-st="text">✍ תיבת טקסט</button>
    <button class="bk-btn" type="button" data-st="img">🖼 תמונה</button>
    <button class="bk-btn" type="button" data-st="rect">▭ מלבן</button>
    <button class="bk-btn" type="button" data-st="ellipse">◯ עיגול</button>
    <button class="bk-btn" type="button" data-st="line">─ קו</button>
    <span class="bk-stglyphs"><button class="bk-btn" type="button" data-st="shapes">⭐ צורות ▾</button>
      <span class="bk-stgpop bk-stspop" hidden>${Object.entries(ST_SHAPES).map(([k, l]) => `<button type="button" data-shape="${k}">${l}</button>`).join("")}</span></span>
    <span class="bk-stglyphs"><button class="bk-btn" type="button" data-st="glyphs">❖ קישוט ▾</button>
      <span class="bk-stgpop" hidden>${ST_GLYPHS.map(c => `<button type="button" data-glyph="${c}">${c}</button>`).join("")}</span></span>
    <span class="bk-stglyphs"><button class="bk-btn" type="button" data-st="parts">🧩 חלקי שער ▾</button>
      <span class="bk-stgpop bk-stppop" hidden>${[["frame", "מסגרת"], ["panel", "לוח"], ["orn", "קישוט"]].map(([pt, pl]) =>
        TP_PARTS[pt].filter(([v]) => v !== "none").map(([v, l]) => `<button type="button" data-addpart="${pt}:${v}">${pl}: ${l}</button>`).join("")).join("")}</span></span>
    <span class="bk-stsep"></span>
    <button class="bk-btn" type="button" data-st="lines" title="השער חוזר לעיצוב לפי שורות (העיצוב החופשי נשמר בצד)">↩ לעיצוב לפי שורות</button>
    <button class="bk-btn" type="button" data-st="focus" aria-pressed="false" title="מסתיר את החלוניות שבצדדים כדי לראות את הדף גדול">⛶ דף גדול</button>
    <button class="bk-btn" type="button" data-st="grid" aria-pressed="${grid}">📏 רשת עזר</button>
    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="bkStFile" hidden/>
  </div>
  <div class="bk-dbody bk-stwrap">
    <div class="bk-stside" id="bkStSide"></div>
    <div class="bk-stcanvas"><div class="bk-stview" id="bkStView"><div class="bk-stc" id="bkStC" tabindex="0" aria-label="השער לעריכה"></div></div>
      <div class="bk-stzoom"><button type="button" data-zm="-1" title="הקטן">−</button><span id="bkStZm">100%</span><button type="button" data-zm="1" title="הגדל">+</button><button type="button" data-zm="0" title="כל העמוד בחלון">⤢ כל הדף</button><button type="button" data-zm="w" title="הדף ברוחב החלון — גדול, גוללים למטה">↔ לרוחב</button></div></div>
    <div class="bk-stlayerpanel"><h4 class="bk-tph">🗂 שכבות</h4><small class="bk-tpnote">העליונה ראשונה · 👁 הסתר · 🔒 נעל</small><div class="bk-stlayers" id="bkStLayers"></div></div>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkCancel">סיום</button>
    <button class="bk-btn" type="button" data-st="lines" title="השער חוזר לעיצוב לפי שורות (העיצוב החופשי נשמר בצד)">↩ חזרה לעיצוב לפי שורות</button>
    <small class="bk-sthelp">גוררים כדי להזיז · ריבועים בפינות לשינוי גודל · העיגול למעלה לסיבוב · חצים להזזה עדינה · Delete למחיקה · Ctrl+D לשכפול</small></footer>`, "bk-studio bk-tpwin" + (lsGet("bk_st_focus", "0") === "1" ? " bk-stfocus" : ""));
  tpWizWire(D);
  if(D.classList.contains("bk-stfocus")) D.querySelector("[data-st=focus]").setAttribute("aria-pressed", "true");
  const C = D.querySelector("#bkStC"), V = D.querySelector("#bkStView"), S = D.querySelector("#bkStSide");
  const page = h("div", {class:"bk-page odd k-title"});
  const over = h("div", {class:"bk-stover"});
  const guideX = h("div", {class:"bk-stguide x", hidden:""}), guideY = h("div", {class:"bk-stguide y", hidden:""});
  C.append(page, over, guideX, guideY);
  const item = (id) => (T().items || []).find(x => x.id === id);
  const elOf = (id) => page.querySelector("[data-tid=\"" + CSS.escape(id) + "\"]");
  const fit = () => {
    k = (Math.min((V.clientWidth - 24) / PW, (V.clientHeight - 24) / PH) || 0.5) * zoom;
    V.classList.toggle("zoomed", zoom > 1);
    const zl = D.querySelector("#bkStZm"); if(zl) zl.textContent = Math.round(zoom * 100) + "%";
    C.style.width = PW * k + "px"; C.style.height = PH * k + "px";
    page.style.transform = "scale(" + k + ")";
    C.classList.toggle("grid", grid);
    C.style.setProperty("--bk-grid", (5 * MM * k) + "px");
    drawSel();
  };
  const draw = () => { page.innerHTML = tpFreeHTML(book, st, T()); drawSel(); };
  const drawSel = () => {
    const it = sel && item(sel);
    if(!it){ over.innerHTML = ""; over.hidden = true; return; }
    over.hidden = false;
    const s = MM * k;
    over.style.cssText = `left:${it.x * s}px;top:${it.y * s}px;width:${it.w * s}px;height:${it.h * s}px;transform:rotate(${tpNum(it.rot, 0)}deg)`;
    if(!over.firstChild) over.innerHTML = ["nw", "ne", "sw", "se", "n", "s", "e", "w", "rot"].map(x => `<i data-h="${x}" class="h-${x}"></i>`).join("");
  };
  const commit = (rerenderSide) => { markDirty(); scheduleLayout(400); if(rerenderSide) side(); };
  const select = (id) => { sel = id; drawSel(); side(); };
  const add = (it) => {
    snap();
    it.id = uid("t");
    T().items = (T().items || []).concat([it]);
    draw(); select(it.id); commit(false);
  };
  const center = (w, h) => ({x:+((g.W - w) / 2).toFixed(2), y:+((g.H - h) / 2).toFixed(2), w, h});
  const fromRecipe = (R, k0) => {
    snap();
    const P = {k:k0 || "", recipe:R, art:(W, H) => tpRecipeArt(W, H, R), items:tpRecipeText(R)};
    const old = T();
    st.tp = Object.assign({}, old, {mode:"free", frame:"none", bg:"", preset:k0 || "", recipe:JSON.parse(JSON.stringify(R)), items:tpRichItems(P, g)});
    sel = null; draw(); commit(true);
  };
  /* ---- the side panel ---- */
  const fld = (label, html) => `<label class="bk-field">${label}${html}</label>`;
  const num = (key, label, step, unit) => `<span class="bk-stnum">${label}<span class="bk-step"><button type="button" data-n="${key}" data-d="${-step}">−</button>`
    + `<input class="bk-input" data-v="${key}" type="number" step="${step}" value="${+tpNum(item(sel)[key], ST_DEF[key] != null ? ST_DEF[key] : 0).toFixed(2)}"/><button type="button" data-n="${key}" data-d="${step}">+</button></span>${unit || ""}</span>`;
  const tog = (key, label) => `<button type="button" class="bk-pill${item(sel)[key] ? " on" : ""}" data-tg="${key}">${label}</button>`;
  const colr = (key, label, dflt) => `<span class="bk-stcol">${label}<input type="color" data-c="${key}" value="${tpCol(item(sel)[key], dflt).slice(0, 7)}"/></span>`;
  const side = () => {
    const it = sel && item(sel);
    const layers = (T().items || []).slice().reverse().map(x => {
      const nm = x.t === "img" ? (x.part ? "🧩 " + (x.pname || TP_PART_NAMES[x.part]) : x.art ? "🧩 העיצוב" : "🖼 תמונה") : x.t === "shape" ? ({rect:"▭ מלבן", ellipse:"◯ עיגול", line:"─ קו"})[x.shape] || "צורה"
        : "✍ " + (x.bind ? tpText(book, {k:x.bind}) : String(x.text || "")).replace(/\s+/g, " ").slice(0, 22);
      return `<div class="bk-stlayer${x.id === sel ? " on" : ""}${x.hide ? " off" : ""}"><button type="button" class="bk-stlname" data-pick="${esc(x.id)}">${esc(nm) || "✍ (ריק)"}</button>`
        + `<button type="button" data-lyr="hide" data-id="${esc(x.id)}" title="${x.hide ? "הצג" : "הסתר"}">${x.hide ? "🚫" : "👁"}</button>`
        + `<button type="button" data-lyr="lock" data-id="${esc(x.id)}" title="${x.lock ? "שחרר" : "נעל"}">${x.lock ? "🔒" : "🔓"}</button>`
        + `<button type="button" data-lyr="up" data-id="${esc(x.id)}" title="שכבה למעלה">▲</button><button type="button" data-lyr="down" data-id="${esc(x.id)}" title="שכבה למטה">▼</button></div>`;
    }).join("");
    D.querySelector("#bkStLayers").innerHTML = layers || `<small class="bk-tpnote">אין עדיין פריטים</small>`;
    if(!it){
      S.innerHTML = `<h4 class="bk-tph">📄 העמוד</h4>
        <div class="bk-hint bk-keep">לוחצים על משהו בשער כדי לשנות אותו, או מוסיפים מהסרגל שלמעלה.</div>
        <h4 class="bk-tph">✨ עיצובים מוכנים</h4>
        <div class="bk-pills bk-strich">${TP_RICH.map(p => `<button type="button" class="bk-pill${T().preset === p.k ? " on" : ""}" data-strich="${p.k}">${esc(p.name)}</button>`).join("")}</div>
        ${T().recipe ? `<h4 class="bk-tph">🧩 חלקי העיצוב</h4>
        <small class="bk-tpnote">מחליפים כל חלק בנפרד — הרקע, המסגרת, הלוח שבאמצע, הקישוט ומראה שם הספר</small>
        ${[["bg", "רקע"], ["frame", "מסגרת"], ["panel", "לוח באמצע"], ["fill", "מילוי הלוח"], ["width", "רוחב הלוח"], ["orn", "קישוט"]].map(([key, l]) =>
          fld(l, `<select class="bk-select" data-rc="${key}">${TP_PARTS[key].map(([v, n]) => `<option value="${v}"${(T().recipe[key] || TP_PARTS[key][0][0]) === v ? " selected" : ""}>${n}</option>`).join("")}</select>`)).join("")}
        ${fld("שם הספר", `<select class="bk-select" data-rc="look">${Object.entries(TP_TITLE_LOOK).map(([v, n]) => `<option value="${v}"${(T().recipe.look || "black") === v ? " selected" : ""}>${n}</option>`).join("")}</select>`)}
        ${fld("גופן שם הספר", `<select class="bk-select" data-rc="tfont">${fontOptions(T().recipe.tfont || "b:frankclm", "פרנק־רוהל עבה")}</select>`)}
        <button type="button" class="bk-pill${T().recipe.label ? " on" : ""}" data-st="rclabel">תווית לבנה לתת־הכותרת</button>
        <small class="bk-tpnote">שינוי חלק מסדר את המילים מחדש לפי העיצוב (אפשר לבטל עם ↶)</small>
        <h4 class="bk-tph">🔀 לקחת חלק מעיצוב אחר</h4>
        <div class="bk-strow">${fld("מה לקחת", `<select class="bk-select" id="bkMixPart">${[["frame", "את המסגרת"], ["orn", "את הקישוט"], ["bg", "את הרקע"], ["panel", "את הלוח שבאמצע"], ["look", "את מראה שם הספר"], ["all", "הכל חוץ מהמילים"]].map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`)}
          ${fld("מאיזה עיצוב", `<select class="bk-select" id="bkMixFrom">${TP_RICH.map(p => `<option value="${p.k}">${esc(p.name)}</option>`).join("")}</select>`)}</div>
        <button type="button" class="bk-btn" data-st="mix">🔀 קח את החלק הזה</button>` : ""}
        <h4 class="bk-tph">💬 תאר במילים מה אתה רוצה</h4>
        <textarea class="bk-input" rows="3" id="bkWords" placeholder="למשל: חלון קשת על אבן ירושלמית, עם סמל למעלה ואותיות כסף בולטות"></textarea>
        <button type="button" class="bk-btn bk-primary" data-st="words">✨ עצב לפי התיאור</button>
        <small class="bk-tpnote">מבינים מילים כמו: אבן, טפט, נייר, ענן · מסגרת כסף, מסגרת לבנה, פיליגרן, עמודים, קווים, מודרני · קשת, קרטוש, קרטוש מעוגל, אליפסה, מלבן · סמל, סלסולים, בלי קישוט · רחב, צר · אותיות כסף, שוליים לבנים · תווית · סת"ם, וילנא, יהודה, שופר, דוד, פרנק</small>
        <div>מסגרת:</div><div class="bk-pills">${TP_FRAMES.map(([v, l]) => `<button type="button" class="bk-pill${(T().frame || "none") === v ? " on" : ""}" data-frame="${v}">${l}</button>`).join("")}</div>
        <span class="bk-stcol">צבע רקע לעמוד<input type="color" data-pagebg="1" value="${tpCol(T().bg, "#ffffff").slice(0, 7)}"/></span>
        ${T().bg ? `<button type="button" class="bk-btn" data-st="nobg">בלי צבע רקע</button>` : ""}`;
      return;
    }
    let body = "";
    if(it.t === "txt"){
      const bound = it.bind ? `<small class="bk-tpnote">קשור ל"${TP_KINDS[it.bind] || ""}" שבפרטי הספר — שינוי כאן משנה גם שם</small>` : "";
      body = fld("הטקסט", `<textarea class="bk-input" rows="3" data-text="1">${esc(it.bind ? tpText(book, {k:it.bind}) : it.text || "")}</textarea>`) + bound
        + fld("גופן", `<select class="bk-select" data-s="font">${fontOptions(it.font || "", "כמו הכותרות בספר")}</select>`)
        + `<div class="bk-strow">${num("size", "גודל", 1, "נק'")}${tog("bold", "<b>ב</b> מודגש")}${tog("hollow", "חלול")}</div>`
        + `<div class="bk-strow"><span>יישור:</span><div class="bk-pills">${[["right", "ימין"], ["center", "מרכז"], ["left", "שמאל"]].map(([v, l]) =>
            `<button type="button" class="bk-pill${(it.al || "center") === v ? " on" : ""}" data-al="${v}">${l}</button>`).join("")}</div></div>`
        + `<div class="bk-strow">${colr("col", "צבע", "#000000")}${num("ls", "ריווח אותיות", 0.05, "")}${num("lh", "בין שורות", 0.05, "")}</div>`
        + `<h5 class="bk-sth5">✨ אפקטים</h5>`
        + `<div class="bk-strow">${num("arc", "קשת (טקסט מעוגל)", 10, "°")}<small class="bk-tpnote">פלוס = קשת למעלה, מינוס = למטה</small></div>`
        + `<div class="bk-strow">${num("sx", "מתיחת אותיות", 5, "%")}</div>`
        + `<div class="bk-strow">${num("str", "קו מתאר לאותיות", 0.25, "נק'")}${colr("strc", "צבע המתאר", "#000000")}</div>`
        + `<div class="bk-strow">${tog("sh", "צל")}${it.sh ? colr("shc", "צבע הצל", "#000000") + num("shd", "מרחק", 0.2, 'מ"מ') : ""}</div>`
        + `<div class="bk-strow">${colr("bgc", "רקע לתיבה", "#ffffff")}${it.bgc ? `<button type="button" class="bk-btn" data-st="nobgc">בלי רקע</button>` : ""}${tog("bdr", "מסגרת לתיבה")}</div>`
        + (it.bdr || it.bgc ? `<div class="bk-strow">${it.bdr ? num("bdw", "עובי המסגרת", 0.2, "נק'") + colr("bdc", "צבע", "#000000") : ""}${num("rad", "עיגול פינות", 1, 'מ"מ')}${num("pad", "ריווח פנימי", 1, 'מ"מ')}</div>` : "");
    }else if(it.t === "img" && it.art){
      body = `<div class="bk-hint bk-keep">חלק מציור השער. גוררים להזזה, הריבועים בפינות לשינוי גודל, העיגול למעלה לסיבוב.</div>`
        + `<div class="bk-strow">${colr("tint", "🎨 צבע החלק", "#9a9aa0")}${it.tint ? `<button type="button" class="bk-btn" data-st="notint">בלי צבע (כמו במקור)</button>` : ""}</div>`
        + `<div class="bk-pills bk-sttints">${["#b08d3c", "#8a6d1f", "#7a1f1f", "#1f3a7a", "#1f5a3a", "#3a2a1a", "#000000", "#ffffff"].map(c => `<button type="button" class="bk-tintsw" data-tint="${c}" style="background:${c}" title="${c}"></button>`).join("")}</div>`
        + `<div class="bk-strow">${tog("flip", "↔ הפוך")}${tog("sh", "צל")}${tog("gray", "שחור-לבן")}</div>`
        + `<div class="bk-strow">${num("bri", "בהירות", 10, "%")}${num("con", "ניגודיות", 10, "%")}</div>`
        + `<div class="bk-strow"><div class="bk-pills"><button type="button" class="bk-pill${it.fit === "fill" ? " on" : ""}" data-fit="fill">נמתח עם המסגרת</button><button type="button" class="bk-pill${it.fit !== "fill" ? " on" : ""}" data-fit="contain">שומר על הצורה</button></div></div>`;
    }else if(it.t === "img"){
      body = `<div class="bk-strow"><div class="bk-pills"><button type="button" class="bk-pill${it.fit !== "fill" ? " on" : ""}" data-fit="contain">כל התמונה</button>`
        + `<button type="button" class="bk-pill${it.fit === "fill" ? " on" : ""}" data-fit="fill">ממלאת את המסגרת</button></div>${tog("gray", "שחור-לבן")}</div>`
        + `<div class="bk-strow">${tog("sepia", "גוון ישן (ספיה)")}${tog("flip", "↔ הפוך")}${tog("sh", "צל")}</div>`
        + `<div class="bk-strow"><span>צורה:</span><div class="bk-pills">${[["", "מלבן"], ["round", "פינות מעוגלות"], ["circle", "עיגול"], ["arch", "קשת"]].map(([v, l]) =>
            `<button type="button" class="bk-pill${(it.clip || "") === v ? " on" : ""}" data-clip="${v}">${l}</button>`).join("")}</div></div>`
        + `<div class="bk-strow">${num("bri", "בהירות", 10, "%")}${num("con", "ניגודיות", 10, "%")}</div>`
        + `<button type="button" class="bk-btn" data-st="replace">🔄 החלף תמונה</button>`;
    }else{
      body = `<div class="bk-strow">${num("sw", "עובי קו", 0.5, "נק'")}${colr("col", "צבע הקו", "#000000")}${tog("dash", "מקווקו")}</div>`
        + (it.shape !== "line" ? `<div class="bk-strow">${colr("fill", "מילוי", "#ffffff")}<button type="button" class="bk-pill${it.fill ? "" : " on"}" data-st="nofill">בלי מילוי</button>${tog("dbl", "קו כפול")}</div>` : "")
        + (it.shape === "rect" ? `<div class="bk-strow">${num("rad", "עיגול פינות", 1, 'מ"מ')}</div>` : "")
        + (it.shape !== "line" && it.fill ? `<div class="bk-strow">${colr("fill2", "מעבר צבע אל", "#ffffff")}${it.fill2 ? `<button type="button" class="bk-pill${it.gdir === "v" ? " on" : ""}" data-tg="gdir">מלמעלה למטה</button><button type="button" class="bk-btn" data-st="nofill2">בלי מעבר</button>` : ""}</div>` : "")
        + (it.shape === "star" || it.shape === "poly" ? `<div class="bk-strow">${num("pts", it.shape === "star" ? "קצוות" : "צלעות", 1, "")}${it.shape === "star" ? num("inner", "עובי", 0.05, "") : ""}</div>` : "")
        + `<div class="bk-strow">${tog("sh", "צל")}${it.sh ? colr("shc", "צבע הצל", "#000000") + num("shd", "מרחק", 0.2, 'מ"מ') : ""}</div>`;
    }
    S.innerHTML = `<h4 class="bk-tph">${it.t === "txt" ? "✍ טקסט" : it.t === "img" ? (it.art ? "🧩 " + esc(it.pname || TP_PART_NAMES[it.part] || "חלק מהשער") : "🖼 תמונה") : "◆ צורה"}</h4>${body}
      <div class="bk-strow">${num("op", "אטימות", 0.1, "")}${num("rot", "סיבוב", 5, "°")}</div>
      <div class="bk-strow">${num("x", "מימין לשמאל", 1, 'מ"מ')}${num("y", "מלמעלה", 1, 'מ"מ')}</div>
      <div class="bk-strow">${num("w", "רוחב", 1, 'מ"מ')}${num("h", "גובה", 1, 'מ"מ')}</div>
      <div class="bk-stacts">
        <button type="button" class="bk-btn" data-st="hcenter">↔ למרכז הרוחב</button>
        <button type="button" class="bk-btn" data-st="vcenter">↕ למרכז הגובה</button>
        <button type="button" class="bk-pill${it.lock ? " on" : ""}" data-tg="lock" title="פריט נעול לא זז בגרירה">🔒 נעל</button>
        <button type="button" class="bk-btn" data-st="front">⬆ קדימה</button>
        <button type="button" class="bk-btn" data-st="back">⬇ אחורה</button>
        <button type="button" class="bk-btn" data-st="dup">⧉ שכפל</button>
        <button type="button" class="bk-btn bk-danger" data-st="del">🗑 מחק</button>
        <button type="button" class="bk-btn" data-st="unpick">סיום עריכת הפריט</button>
      </div>`;
  };
  /* ---- pictures ---- */
  const FILE = D.querySelector("#bkStFile");
  let replacing = null;
  FILE.addEventListener("change", () => {
    const f = FILE.files && FILE.files[0];
    FILE.value = "";
    if(!f) return;
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        const max = 1600, s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(im.naturalWidth * s)); cv.height = Math.max(1, Math.round(im.naturalHeight * s));
        cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
        let src = /png|gif|webp/.test(f.type) ? cv.toDataURL("image/png") : "";
        if(!src || src.length > 1500000) src = cv.toDataURL("image/jpeg", 0.88);
        const total = JSON.stringify(T()).length + src.length;
        if(total > 8 * 1024 * 1024){ toast("יש כבר הרבה תמונות בשער — התמונה גדולה מדי", "warn"); return; }
        if(replacing && item(replacing)){
          snap(); item(replacing).src = src; replacing = null; draw(); commit(true); return;
        }
        const w = Math.min(g.W * 0.6, 70), hh = w * cv.height / cv.width;
        add(Object.assign({t:"img", src, fit:"contain"}, center(w, Math.min(hh, g.H * 0.7))));
      };
      im.onerror = () => toast("לא הצלחתי לפתוח את התמונה", "warn");
      im.src = r.result;
    };
    r.readAsDataURL(f);
  });
  /* ---- toolbar and panel clicks ---- */
  D.addEventListener("click", e => {
    const b = e.target.closest("button");
    if(!b || !D.contains(b)) return;
    const it = sel && item(sel);
    if(b.dataset.shape){
      D.querySelector(".bk-stspop").hidden = true;
      const sq = ["star", "poly", "medal", "diamond", "oval"].includes(b.dataset.shape);
      add(Object.assign({t:"shape", shape:b.dataset.shape, sw:1, col:"#000000"}, center(sq ? 50 : 90, sq ? 50 : b.dataset.shape === "ribbon" ? 32 : 60)));
      return;
    }
    if(b.dataset.glyph){
      D.querySelector(".bk-stgpop:not(.bk-stspop)").hidden = true;
      add(Object.assign({t:"txt", text:b.dataset.glyph, size:24, al:"center", lh:1}, center(20, 14)));
      return;
    }
    if(b.dataset.pick){ select(b.dataset.pick); return; }
    if(b.dataset.tint || b.dataset.st === "notint"){
      const it = sel && item(sel); if(!it) return;
      snap(); if(b.dataset.tint) it.tint = b.dataset.tint; else delete it.tint;
      draw(); commit(true); return;
    }
    if(b.dataset.addpart){
      D.querySelector(".bk-stppop").hidden = true;
      const [pt, v] = b.dataset.addpart.split(":");
      const base = T().recipe || {bg:"white", frame:"none", panel:"none", fill:"white", orn:"none", width:"n"};
      const Rr = Object.assign({}, base, {[pt]:v});
      if(pt === "orn" && Rr.panel === "none") Rr.panel = "cartouche";
      const its = tpArtParts(Rr, g, pt);
      if(!its.length){ toast("לא נמצא ציור לחלק הזה", "warn"); return; }
      snap();
      for(const it of its){ it.lock = false; T().items = (T().items || []).concat([it]); }
      draw(); select(its[its.length - 1].id); commit(false); toast("נוסף: " + b.textContent + " — אפשר להזיז, להגדיל ולהסתיר", "ok");
      return;
    }
    if(b.dataset.zm === "w"){ zoom = Math.max(1, ((V.clientWidth - 40) / PW) / (Math.min((V.clientWidth - 24) / PW, (V.clientHeight - 24) / PH) || 1)); fit(); return; }
    if(b.dataset.zm != null){ const d = Number(b.dataset.zm); zoom = d ? Math.max(.5, Math.min(4, +(zoom * (d > 0 ? 1.25 : .8)).toFixed(3))) : 1; fit(); return; }
    if(b.dataset.lyr){
      const its = T().items || [], i = its.findIndex(x => x.id === b.dataset.id), x = its[i];
      if(!x) return;
      snap();
      if(b.dataset.lyr === "hide"){ x.hide = !x.hide; if(x.hide && sel === x.id) sel = null; }
      else if(b.dataset.lyr === "lock") x.lock = !x.lock;
      else { const j = i + (b.dataset.lyr === "up" ? 1 : -1); if(j < 0 || j >= its.length) return; [its[i], its[j]] = [its[j], its[i]]; }
      draw(); commit(true); return;
    }
    if(b.dataset.strich){ const P = TP_RICH.find(x => x.k === b.dataset.strich); if(P) fromRecipe(P.recipe, P.k); return; }
    if(b.dataset.st === "mix" && T().recipe){
      const part = D.querySelector("#bkMixPart").value, P = TP_RICH.find(x => x.k === D.querySelector("#bkMixFrom").value);
      if(!P) return;
      const keys = {frame:["frame"], orn:["orn"], bg:["bg"], panel:["panel", "fill", "width"], look:["look", "tfont", "tsize"], all:["bg", "frame", "panel", "fill", "width", "orn", "look", "tfont", "tsize", "label"]}[part];
      const R = Object.assign({}, T().recipe);
      keys.forEach(x => { if(P.recipe[x] === undefined) delete R[x]; else R[x] = P.recipe[x]; });
      fromRecipe(R, "");
      toast("נלקח מ«" + P.name + "» — אפשר לבטל עם ↶", "ok");
      return;
    }
    if(b.dataset.st === "words"){
      const txt = D.querySelector("#bkWords").value.trim();
      if(!txt){ toast("כתוב קודם במילים איך השער צריך להיראות", "warn"); return; }
      const {R, got} = tpFromWords(txt, T().recipe);
      if(!got.length){ toast("לא הבנתי מה לשנות — נסה מילים כמו: קשת, אבן, מסגרת כסף, סמל, אותיות כסף", "warn"); return; }
      fromRecipe(R, "");
      toast("הבנתי: " + got.join(" · "), "ok");
      return;
    }
    if(b.dataset.st === "rclabel" && T().recipe){ fromRecipe(Object.assign({}, T().recipe, {label:!T().recipe.label})); return; }
    if(b.dataset.frame){ snap(); T().frame = b.dataset.frame; draw(); commit(true); return; }
    if(b.dataset.al && it){ snap(); it.al = b.dataset.al; draw(); commit(true); return; }
    if(b.dataset.fit && it){ snap(); it.fit = b.dataset.fit; draw(); commit(true); return; }
    if(b.dataset.clip != null && it){ snap(); it.clip = b.dataset.clip; draw(); commit(true); return; }
    if(b.dataset.tg && it){ snap(); if(b.dataset.tg === "gdir") it.gdir = it.gdir === "v" ? "" : "v"; else it[b.dataset.tg] = !it[b.dataset.tg]; draw(); commit(true); return; }
    if(b.dataset.n && it){
      snap();
      const key = b.dataset.n, lim = {op:[0.05, 1], size:[4, 200], sw:[0, 20], w:[1, 400], h:[0.5, 400], ls:[-0.2, 2], lh:[0.6, 3], rad:[0, 100],
        arc:[-300, 300], sx:[30, 300], str:[0, 6], bri:[20, 250], con:[20, 250], pts:[3, 16], inner:[0.1, 0.9], shd:[0.2, 4], pad:[0, 20], bdw:[0.3, 6]}[key];
      let v = +(tpNum(it[key], ST_DEF[key] != null ? ST_DEF[key] : 0) + Number(b.dataset.d)).toFixed(2);
      if(lim) v = Math.max(lim[0], Math.min(lim[1], v));
      it[key] = v; draw(); commit(true); return;
    }
    const a = b.dataset.st;
    if(!a) return;
    if(a === "undo" || a === "redo"){
      const from = a === "undo" ? undoStack : redoStack, to = a === "undo" ? redoStack : undoStack;
      if(!from.length) return;
      to.push(JSON.stringify(T())); st.tp = JSON.parse(from.pop());
      if(sel && !item(sel)) sel = null;
      draw(); commit(true); return;
    }
    if(a === "text") add(Object.assign({t:"txt", text:"טקסט חדש", size:18, al:"center", lh:1.25}, center(Math.min(100, g.W - 30), 14)));
    else if(a === "img"){ replacing = null; FILE.click(); }
    else if(a === "replace" && it){ replacing = it.id; FILE.click(); }
    else if(a === "rect") add(Object.assign({t:"shape", shape:"rect", sw:1, col:"#000000"}, center(80, 50)));
    else if(a === "ellipse") add(Object.assign({t:"shape", shape:"ellipse", sw:1, col:"#000000"}, center(50, 50)));
    else if(a === "line") add(Object.assign({t:"shape", shape:"line", sw:0.8, col:"#000000"}, center(70, 3)));
    else if(a === "glyphs"){ const p = D.querySelector(".bk-stgpop:not(.bk-stspop)"); p.hidden = !p.hidden; }
    else if(a === "shapes"){ const p = D.querySelector(".bk-stspop"); p.hidden = !p.hidden; }
    else if(a === "parts"){ const p = D.querySelector(".bk-stppop"); p.hidden = !p.hidden; }
    else if(a === "focus"){ const on = !D.classList.contains("bk-stfocus"); D.classList.toggle("bk-stfocus", on); b.setAttribute("aria-pressed", String(on)); lsSet("bk_st_focus", on ? "1" : "0"); requestAnimationFrame(fit); }
    else if(a === "grid"){ grid = !grid; lsSet("bk_st_grid", grid ? "1" : "0"); b.setAttribute("aria-pressed", String(grid)); fit(); }
    else if(a === "nobg"){ snap(); T().bg = ""; draw(); commit(true); }
    else if(a === "nofill" && it){ snap(); it.fill = ""; it.fill2 = ""; draw(); commit(true); }
    else if(a === "nofill2" && it){ snap(); it.fill2 = ""; draw(); commit(true); }
    else if(a === "nobgc" && it){ snap(); it.bgc = ""; draw(); commit(true); }
    else if(it && a === "vcenter"){ snap(); it.y = +((g.H - it.h) / 2).toFixed(2); draw(); commit(true); }
    else if(a === "unpick") select(null);
    else if(a === "lines"){
      T().mode = "lines"; markDirty(); scheduleLayout(200); closeModal();
      toast("השער חזר לעיצוב לפי שורות. העיצוב החופשי נשמר — אפשר לחזור אליו בכפתור הסטודיו", "ok");
    }
    else if(it && a === "del"){ snap(); T().items = T().items.filter(x => x !== it); sel = null; draw(); commit(true); }
    else if(it && a === "dup"){ const c = JSON.parse(JSON.stringify(it)); c.x += 5; c.y += 5; add(c); }
    else if(it && (a === "front" || a === "back")){
      snap();
      const L = T().items, i = L.indexOf(it), j = a === "front" ? Math.min(L.length - 1, i + 1) : Math.max(0, i - 1);
      L.splice(i, 1); L.splice(j, 0, it); draw(); commit(true);
    }
    else if(it && a === "hcenter"){ snap(); it.x = +((g.W - it.w) / 2).toFixed(2); draw(); commit(true); }
  });
  D.addEventListener("focusin", e => { if(e.target.matches("[data-text],[data-v],[data-c],[data-pagebg]")) snap(); });
  D.addEventListener("input", e => {
    const s = e.target, it = sel && item(sel);
    if(s.dataset.pagebg){ T().bg = s.value; draw(); commit(false); return; }
    if(!it) return;
    if(s.dataset.text){
      if(it.bind){
        const f = {title:"title", sub:"subtitle", auth:"author"}[it.bind];
        if(f){ book[f] = s.value; if(f === "title") renderTop(); }
        else{ const [p, ...y] = s.value.split("\n"); book.place = p || ""; book.year = y.join(" "); }
      }else it.text = s.value;
      draw(); commit(false); return;
    }
    if(s.dataset.v){ const v = Number(s.value); if(isFinite(v)){ it[s.dataset.v] = v; draw(); commit(false); } return; }
    if(s.dataset.c){ it[s.dataset.c] = s.value; draw(); commit(false); }
  });
  D.addEventListener("change", e => {
    const s = e.target, it = sel && item(sel);
    if(it && s.dataset.s){ snap(); it[s.dataset.s] = s.value; draw(); commit(false); }
    if(s.dataset.rc && T().recipe) fromRecipe(Object.assign({}, T().recipe, {[s.dataset.rc]:s.value}), "");
  });
  /* ---- the page: pick, move, resize, turn ---- */
  let drag = null;
  const mmAt = (e) => { const r = C.getBoundingClientRect(); return {x:(e.clientX - r.left) / (MM * k), y:(e.clientY - r.top) / (MM * k)}; };
  C.addEventListener("pointerdown", e => {
    const hd = e.target.closest("[data-h]");
    let it = sel && item(sel);
    if(!hd){
      const hit = e.target.closest("[data-tid]");
      if(!hit){ if(!e.target.closest(".bk-stover")){ select(null); return; } }
      else if(hit.dataset.tid !== sel){ select(hit.dataset.tid); it = item(sel); }
    }
    if(!it) return;
    e.preventDefault();
    C.focus({preventScroll:true});
    C.setPointerCapture(e.pointerId);
    if(it.lock) return;   // a locked item can be picked, not moved
    drag = {h:hd ? hd.dataset.h : "move", p:mmAt(e), o:JSON.parse(JSON.stringify(it)), moved:false};
  });
  C.addEventListener("pointermove", e => {
    if(!drag) return;
    const it = item(sel);
    if(!it) return;
    const p = mmAt(e), dx = p.x - drag.p.x, dy = p.y - drag.p.y, o = drag.o;
    if(!drag.moved){ if(Math.abs(dx) + Math.abs(dy) < 0.4) return; snap(); drag.moved = true; }
    guideX.hidden = guideY.hidden = true;
    if(drag.h === "move"){
      let x = o.x + dx, y = o.y + dy;
      // snap the middle of the item to the middle of the page
      if(Math.abs(x + o.w / 2 - g.W / 2) < 1.5){ x = g.W / 2 - o.w / 2; guideX.hidden = false; guideX.style.left = (g.W / 2) * MM * k + "px"; }
      if(Math.abs(y + o.h / 2 - g.H / 2) < 1.5){ y = g.H / 2 - o.h / 2; guideY.hidden = false; guideY.style.top = (g.H / 2) * MM * k + "px"; }
      it.x = +x.toFixed(2); it.y = +y.toFixed(2);
    }else if(drag.h === "rot"){
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      let a = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
      if(!e.shiftKey) a = Math.round(a / 5) * 5;
      a = ((a + 540) % 360) - 180;
      it.rot = Math.abs(a) < 2 ? 0 : a;
    }else{
      let {x, y, w, h: hh} = o;
      const H = drag.h;
      if(H.includes("e")){ w = Math.max(2, o.w + dx); }
      if(H.includes("w")){ w = Math.max(2, o.w - dx); x = o.x + o.w - w; }
      if(H.includes("s")){ hh = Math.max(1, o.h + dy); }
      if(H.includes("n")){ hh = Math.max(1, o.h - dy); y = o.y + o.h - hh; }
      // a picture keeps its shape when pulled from a corner (Shift: free)
      if(it.t === "img" && H.length === 2 && !e.shiftKey){
        const r = o.h / o.w; hh = w * r;
        if(H.includes("n")) y = o.y + o.h - hh;
      }
      Object.assign(it, {x:+x.toFixed(2), y:+y.toFixed(2), w:+w.toFixed(2), h:+hh.toFixed(2)});
    }
    const el = elOf(it.id);
    if(el){ const tmp = h("div", null, tpItemHTML(book, st, it)).firstElementChild; el.replaceWith(tmp); }
    drawSel();
  });
  const end = () => {
    if(!drag) return;
    const moved = drag.moved;
    drag = null; guideX.hidden = guideY.hidden = true;
    if(moved){ commit(true); }
  };
  C.addEventListener("pointerup", end);
  C.addEventListener("pointercancel", end);
  C.addEventListener("dblclick", e => {
    if(!e.target.closest("[data-tid]")) return;
    const ta = S.querySelector("[data-text]");
    if(ta){ ta.focus(); ta.select(); }
  });
  C.addEventListener("keydown", e => {
    const it = sel && item(sel);
    const mod = e.ctrlKey || e.metaKey;
    if(mod && e.code === "KeyZ"){ e.preventDefault(); D.querySelector("[data-st=\"" + (e.shiftKey ? "redo" : "undo") + "\"]").click(); return; }
    if(mod && e.code === "KeyY"){ e.preventDefault(); D.querySelector("[data-st=\"redo\"]").click(); return; }
    if(!it) return;
    if(e.key === "Delete" || e.key === "Backspace"){ e.preventDefault(); D.querySelector("[data-st=\"del\"]").click(); return; }
    if(mod && e.code === "KeyD"){ e.preventDefault(); D.querySelector("[data-st=\"dup\"]").click(); return; }
    const step = e.shiftKey ? 5 : 0.5;
    const mv = {ArrowLeft:[-step, 0], ArrowRight:[step, 0], ArrowUp:[0, -step], ArrowDown:[0, step]}[e.key];
    if(mv){ e.preventDefault(); snap(); it.x = +(it.x + mv[0]).toFixed(2); it.y = +(it.y + mv[1]).toFixed(2); draw(); commit(true); }
  });
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  V.addEventListener("wheel", e => {
    if(!e.ctrlKey) return;
    e.preventDefault();
    zoom = Math.max(.5, Math.min(4, +(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)).toFixed(3))); fit();
  }, {passive:false});
  const ro = new ResizeObserver(() => fit());
  ro.observe(V);
  onModalClose = () => ro.disconnect();
  draw(); side(); fit();
  setTimeout(() => C.focus({preventScroll:true}), 50);
}
function noteDialog(series, ta){
  const at = ta.selectionStart;
  const D = modal(`<header><h3>${series === "a" ? "➕ הערה בתחתית העמוד" : "➕ מראה מקום"}</h3></header>
  <div class="bk-dbody">
    <div>${series === "a" ? "כתבו את ההערה. היא תודפס בתחתית העמוד, עם מספר קטן במקום שבו עמד הסמן." : "כתבו את המקור (למשל: ברכות ה. ; רמב\"ם הל' תפילה פ\"א). הוא יודפס בתחתית העמוד בסדרה נפרדת."}</div>
    <textarea class="bk-textarea" id="bkNoteText" style="min-height:150px" dir="rtl"></textarea>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkOk">הוסף</button><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelector("#bkOk").addEventListener("click", () => {
    const txt = D.querySelector("#bkNoteText").value.replace(/[{}]/g, "").replace(/\s*\n\s*/g, " ").trim();
    closeModal();
    if(!txt) return;
    let p = at;
    while(p > 0 && ta.value[p - 1] === " ") p--;
    insertText(ta, series === "a" ? "{" + txt + "}" : "{{" + txt + "}}", p);
  });
}

/* --------------------------------------------------------------- import */
function showImport(){
  const D = modal(`<header><h3>📥 מאיפה להביא את הטקסט?</h3></header>
  <div class="bk-dbody"><div class="bk-choices">
    <button class="bk-choice" type="button" data-imp="word"><b>📄 קובץ Word</b><small>‎.docx‎ — ההערות והכותרות נשמרות</small></button>
    <button class="bk-choice" type="button" data-imp="paste"><b>📋 הדבקת טקסט ארוך</b><small>הכותרות (פרק…, סימן…) מזוהות לבד</small></button>
    <button class="bk-choice" type="button" data-imp="archive"><b>🖼 דפים שזוהו בתוכנה</b><small>הטקסט שנקרא מכתבי היד שלך</small></button>
    <button class="bk-choice" type="button" data-imp="txt"><b>📝 קובץ טקסט</b><small>‎.txt‎</small></button>
  </div></div>
  <footer><button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelectorAll("[data-imp]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.imp;
    closeModal();
    if(k === "word") pickFile(".docx");
    else if(k === "txt") pickFile(".txt");
    else if(k === "paste") pasteDialog();
    else if(k === "archive") archiveDialog();
  }));
}
function pickFile(accept){
  const inp = h("input", {type:"file", accept});
  inp.style.display = "none";
  ROOT.appendChild(inp);
  inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; inp.remove(); if(f) importFile(f); });
  inp.click();
}
async function importFile(f){
  const name = (f.name || "").toLowerCase();
  if(name.endsWith(".docx")){
    progressBox("קורא את קובץ ה-Word…");
    try{
      const buf = await f.arrayBuffer();
      const res = await call("/api/book/import-docx", {method:"POST", headers:{"Content-Type":"application/octet-stream"}, body:buf});
      closeModal();
      const secs = (res.sections || []).map(s => ({id:uid("s"), kind:s.kind, title:s.title || "", text:s.text || ""}));
      if(!secs.length){ toast("לא נמצא טקסט בקובץ", "warn"); return; }
      addSections(secs, res.title, (res.notes ? res.notes + " הערות, " : "") + secs.length + " קטעים");
    }catch(e){ closeModal(); toast(e.message || String(e), "err"); }
    return;
  }
  if(name.endsWith(".txt") || (f.type || "").startsWith("text/")){
    const buf = await f.arrayBuffer();
    let text;
    try{ text = new TextDecoder("utf-8", {fatal:true}).decode(buf); }
    catch(e){ try{ text = new TextDecoder("windows-1255").decode(buf); }catch(e2){ text = new TextDecoder().decode(buf); } }
    const secs = smartSplit(text.replace(/^\uFEFF/, ""), false);
    if(!secs.length){ toast("הקובץ ריק", "warn"); return; }
    addSections(secs, "", secs.length + " קטעים");
    return;
  }
  if(name.endsWith(".doc")){ toast("זהו קובץ Word ישן (‎.doc‎). פתחו אותו ב-Word ושמרו בשם כ-‎.docx‎ — ואז ייבאו", "warn"); return; }
  toast("אפשר לייבא קובץ Word (‎.docx‎) או קובץ טקסט (‎.txt‎)", "warn");
}
function kindForTitle(title, level){
  const first = (String(title).trim().split(/\s+/)[0]) || "";
  if(/^הקדמ|^פתיחה$|^מבוא$|^פתח$/.test(first)) return "intro";
  if(/^הסכמ/.test(first)) return "haskama";
  return level <= 1 ? "chapter" : "siman";
}
function joinManuscript(text){
  const out = [];
  let cur = "";
  for(const raw of String(text || "").replace(/\r/g, "").split("\n")){
    const t = raw.trim();
    if(!t){ if(cur){ out.push(cur); cur = ""; } continue; }
    cur = cur ? cur + " " + t : t;
    if(/[:׃.]$/.test(t)){ out.push(cur); cur = ""; }
  }
  if(cur) out.push(cur);
  return out.join("\n");
}
function smartSplit(text, joinLines){
  const secs = [];
  let cur = null;
  for(const raw of String(text || "").replace(/\r/g, "").split("\n")){
    const t = raw.trim();
    if(!t){ if(cur && joinLines) cur.text += "\n"; continue; }
    const plain = t.replace(/\*/g, "").trim();
    const words = plain.split(/\s+/);
    const isHead = words.length <= 9 && plain.length <= 70 && !/[.,:;]$/.test(plain) && !/[{}]/.test(t)
      && (HEAD1.includes(words[0]) || HEAD2.includes(words[0]) || /^הקדמ|^הסכמ/.test(words[0]) || /^\*[^*]+\*$/.test(t));
    if(isHead){
      const level = (HEAD2.includes(words[0]) || /^\*[^*]+\*$/.test(t)) && !HEAD1.includes(words[0]) ? 2 : 1;
      cur = {id:uid("s"), kind:kindForTitle(plain, level), title:plain, text:"", bare: words.length <= 2 && (HEAD1.includes(words[0]) || HEAD2.includes(words[0]))};
      secs.push(cur);
      continue;
    }
    // "פרק א" alone, and the next line is a short name with no full stop: it is the heading's name
    if(cur && cur.bare && !cur.text && plain.split(/\s+/).length <= 8 && plain.length <= 60 && !/[.,:;]$/.test(plain) && !/[{}]/.test(t)){
      cur.title += " - " + plain; cur.bare = false;
      continue;
    }
    if(cur) cur.bare = false;
    if(!cur){ cur = {id:uid("s"), kind:"text", title:"", text:""}; secs.push(cur); }
    cur.text += (cur.text && !cur.text.endsWith("\n") ? "\n" : "") + t;
  }
  for(const s of secs){ delete s.bare; s.text = joinLines ? joinManuscript(s.text) : s.text.replace(/\n{2,}/g, "\n").trim(); }
  return secs;
}
// Eli (11-01): "פעם אחת אבא יגדיר מה זה פסקה בספר החדש ואז הגדרה אחת תחול על כל הספר".
// Right after text comes into a book that had none: how is it divided into paragraphs (with the
// count each choice gives), and whether to open every paragraph like עושה חיל. Both are whole-book
// settings; they can be changed later in the design tab.
function paraCounts(){
  const counts = {};
  for(const [v] of [["", "a"], ["line", "l"], ["section", "s"], ["pasuk", "p"]]){
    const t = Object.assign({}, st, {paraJoin: v});
    if(v === "pasuk" && (st.paraJoin !== "pasuk" || !String(st.diburMarks || "").trim())){ t.diburUntil = "marks"; t.diburMarks = st.diburMarks || "colon"; }
    counts[v] = book.sections.reduce((n, sec) => n + paraLines(sec.text, t).filter(x => x[0].trim() && !/^(#|=|~~|\*\*\*)/.test(x[0].trim())).length, 0);
  }
  counts.quotes = quoteCount(st);
  return counts;
}
function quoteCount(t){
  return book.sections.reduce((k, sec) => k + paraLines(sec.text, t).filter(x => /^\s*(»+\s*)?(\[\[.+?\]\]\s*)?>/.test(x[0]) || isQuoteRule(x[0], t)).length, 0);
}
// after text first comes in: find the paragraphs alone and show one line with the result. The DESIGN stays the
// one of the book's type (v1.8.89: pasting no longer turns every book into עושה חיל); "לא נכון?" opens the choices
function paraDefAuto(){
  const counts = paraCounts();
  st.paraJoin = "";
  markDirty(); scheduleLayout(0);
  const old = document.getElementById("bkParaBar");
  if(old) old.remove();
  const bar = h("div", {class:"bk-parabar", id:"bkParaBar", role:"status"});
  const ps = pasukOpenShare(book, {diburMarks: "colon,bracket"});
  const pasukHint = ps.k >= 3 && ps.share >= 0.5 ? `<button type="button" class="bk-btn bk-small" id="bkParaPasuk">📜 נראה שכל קטע פותח בפסוק (${ps.k} קטעים) — להגדיר איך מזהים אותו</button>` : "";
  const T = BOOK_TYPES.find(x => x.k === st.bookType);
  bar.innerHTML = `<span>✓ זוהו <b>${counts[""]}</b> פסקאות${T ? ", בעיצוב של " + T.icon + " " + T.name : ""}.</span>${pasukHint}
    <button type="button" class="bk-btn bk-small" id="bkParaFix">לא נכון? לשנות</button>
    <button type="button" class="bk-btn bk-small bk-soft" id="bkParaOk" aria-label="סגור">✕</button>`;
  const viewer = $("bkViewer");
  viewer.parentElement.insertBefore(bar, viewer);   // inside the preview column, right above the pages
  bar.querySelector("#bkParaOk").addEventListener("click", () => bar.remove());
  bar.querySelector("#bkParaFix").addEventListener("click", () => { bar.remove(); paraDefDialog(); });
  const pb = bar.querySelector("#bkParaPasuk");
  if(pb) pb.addEventListener("click", () => { bar.remove(); paraDefDialog("pasuk"); });
  setTimeout(() => { if(bar.isConnected) bar.remove(); }, 90000);
}
function paraDefDialog(preselect){
  const counts = paraCounts();
  let dmarks = diburMarkSet(st.paraJoin === "pasuk" || preselect === "pasuk" ? Object.assign({}, st, {diburUntil: st.diburUntil === "auto" ? "marks" : st.diburUntil, diburMarks: st.diburMarks || (st.diburUntil === "auto" ? "colon" : "")}) : {diburMarks: "colon"});
  const markPills = () => DIBUR_MARKS.map(([v, l]) => `<button type="button" class="bk-pill${dmarks.includes(v) ? " on" : ""}" data-dm="${v}" aria-pressed="${dmarks.includes(v)}">${l}</button>`).join("");
  const lines = book.sections.reduce((n, sec) => n + String(sec.text || "").split(/\r?\n/).filter(x => x.trim()).length, 0);
  const opt = (v, b, sm) => `<button class="bk-choice${(st.paraJoin || "") === v ? " on" : ""}" type="button" data-pj="${v}"><b>${b}</b><small>${sm} — <b>${counts[v]} פסקאות</b></small></button>`;
  const D = modal(`<header><h3>📑 מה נחשב פסקה ומה ציטוט בספר הזה?</h3></header>
  <div class="bk-dbody">
    <div>הטקסט נכנס לספר (${lines} שורות). ההגדרה הזו חלה על כל הספר, וכל עיצוב של פסקה (אות גדולה, חלון, הזחה) ייפול לפיה.</div>
    <div class="bk-choices">
      ${opt("", "🔎 לזהות לבד", "טקסט שהועתק מספר ושבור לשורות מתחבר לפסקאות; טקסט שכל שורה בו פסקה נשאר כך")}
      ${opt("line", "↵ כל שורה היא פסקה", "כמו שהוקלד: ירידת שורה = פסקה חדשה")}
      ${opt("section", "▬ כל קטע הוא פסקה אחת", "כל השורות של קטע מתחברות לפסקה אחת ארוכה")}
      ${opt("pasuk", "📜 כל קטע פותח בציטוט פסוק עד סימן", "לספר על הפרשה: קטע חדש מתחיל רק בשורה שפותחת במילות הפסוק עד הסימן שבחרתם, אחרי שהקטע הקודם נגמר; מילות הפסוק יוצאות מודגשות בסגנון \"ציטוט מפסוק\". פסוק באמצע קטע (במירכאות, או באמצע משפט) לא פותח קטע חדש")}
    </div>
    <div class="bk-ctl" id="bkDmRow"><span class="bk-ctl-l">הסימן שמסיים את ציטוט הפסוק בתחילת הקטע (אפשר כמה):</span><div class="bk-pills" id="bkDm">${markPills()}</div>
      <small class="bk-tpnote">לפי הסימן הזה מזוהים <b id="bkPasukN">${counts.pasuk}</b> קטעים. זה גם הסימן שעד אליו מודגש הדיבור המתחיל.</small></div>
    <h4 class="bk-h4">❝ מה נחשב ציטוט (ולא פסקה רגילה)?</h4>
    <div class="bk-tpnote">ציטוט מוצג מוזח משני הצדדים ובאות קצת קטנה יותר, בלי אות גדולה ובלי חלון. לפי ההגדרה הזו יש בספר <b id="bkQuoteN">${counts.quotes}</b> ציטוטים.</div>
    <div class="bk-choices" id="bkQHow">
      <button class="bk-choice${st.quoteInline ? "" : " on"}" type="button" data-qi="0"><b>▬ קטע נפרד</b><small>הציטוט יוצא כפסקה משלו, מוזחת משני הצדדים</small></button>
      <button class="bk-choice${st.quoteInline ? " on" : ""}" type="button" data-qi="1"><b>¶ חלק מהקטע</b><small>הציטוט נשאר בתוך הפסקה, רק באות אחרת (סגנון "ציטוט בתוך הקטע")</small></button>
    </div>
    <label class="bk-check"><input type="checkbox" disabled checked/><span>שורה שמתחילה בסימן &gt;<small>תמיד קטע נפרד — כך מסמנים ציטוט ביד</small></span></label>
    <label class="bk-check"><input type="checkbox" id="bkQByQuotes"${st.quoteByQuotes ? " checked" : ""}/><span>פסקה שמתחילה במירכאות<small>" ״ ' — כמו ״כל ישראל יש להם חלק…״</small></span></label>
    <label class="bk-check"><input type="checkbox" id="bkQByIndent"${st.quoteByIndent ? " checked" : ""}/><span>שורה שהוקלדה עם רווחים או טאב בתחילתה<small>כמו שמזיחים ציטוט במעבד תמלילים</small></span></label>
    <label class="bk-check bk-check-col"><span>ציטוט שמתחיל באחת המילים האלה<small id="bkQWordsHelp">מילה בכל שורה, או מופרדות בפסיק. למשל: וז"ל, זה לשונו, כתב, אמר. כשהציטוט הוא חלק מהקטע הוא נמשך עד עכ"ל / ע"כ או עד סוף המשפט</small></span>
      <textarea id="bkQWords" rows="3" dir="rtl" placeholder="וז&quot;ל&#10;זה לשונו&#10;כתב" aria-describedby="bkQWordsHelp">${esc(String(st.quoteWords || ""))}</textarea></label>
    <label class="bk-check"><input type="checkbox" id="bkPasukAuto"${st.pasukAuto ? " checked" : ""}/><span>📜 מילים בתוך מירכאות ״…״ הן ציטוט מפסוק<small>בתוך הפסקה, לא פסקה נפרדת — יוצאות בסגנון "ציטוט מפסוק" (מודגש); אפשר גם לסמן ביד בעורך</small></span></label>
    <div class="bk-tpnote">📜 <b>הדיבור המתחיל (ד"ה)</b> — עד איזה סימן הוא נמשך (מקף, נקודה, חצי סוגר מרובע <bdi dir="ltr">]</bdi>…) והאם הוא ציטוט מפסוק:
      <button type="button" class="bk-link" id="bkDibGo">בלשונית 🖋 סגנונות ← דיבור המתחיל</button></div>
    <h4 class="bk-h4">פתיחת פסקה</h4>
    <label class="bk-check"><input type="checkbox" id="bkLikeOse"${st.opener === "window" && st.openerEvery ? " checked" : ""}/><span>לעצב כל פסקה כמו בעושה חיל<small>המילה הראשונה מודגשת והשורה השנייה מוזחת לידה ("חלון"), בכל פסקה בספר</small></span></label>
    <small class="bk-tpnote">אפשר לשנות אחר כך בלשונית "🎨 עיצוב" (פסקאות / פתיחת פסקה) ובלשונית "🖋 סגנונות".</small>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkOk">✓ זו ההגדרה לכל הספר</button></footer>`);
  let pick = preselect === "pasuk" ? "pasuk" : (st.paraJoin || "");
  const showDm = () => { D.querySelector("#bkDmRow").hidden = pick !== "pasuk"; };
  D.querySelectorAll("[data-pj]").forEach(b => b.addEventListener("click", () => {
    pick = b.dataset.pj;
    D.querySelectorAll("[data-pj]").forEach(x => x.classList.toggle("on", x === b));
    showDm();
  }));
  if(preselect === "pasuk") D.querySelectorAll("[data-pj]").forEach(x => x.classList.toggle("on", x.dataset.pj === "pasuk"));
  showDm();
  const probeSt = () => Object.assign({}, st, {paraJoin: "pasuk", diburUntil: "marks", diburMarks: dmarks.join(",")});
  D.querySelectorAll("[data-dm]").forEach(b => b.addEventListener("click", () => {
    const v = b.dataset.dm, at = dmarks.indexOf(v);
    if(at >= 0){ if(dmarks.length === 1){ toast("צריך להשאיר לפחות סימן אחד", "warn"); return; } dmarks.splice(at, 1); } else dmarks.push(v);
    b.classList.toggle("on", dmarks.includes(v)); b.setAttribute("aria-pressed", String(dmarks.includes(v)));
    const t = probeSt();
    D.querySelector("#bkPasukN").textContent = book.sections.reduce((n, sec) => n + paraLines(sec.text, t).filter(x => x[0].trim() && !/^(#|=|~~|\*\*\*)/.test(x[0].trim())).length, 0);
  }));
  let qInline = !!st.quoteInline;
  D.querySelectorAll("[data-qi]").forEach(b => b.addEventListener("click", () => {
    qInline = b.dataset.qi === "1";
    D.querySelectorAll("[data-qi]").forEach(x => x.classList.toggle("on", x === b));
  }));
  const readQuotes = () => ({quoteInline: qInline, quoteByQuotes: D.querySelector("#bkQByQuotes").checked, quoteByIndent: D.querySelector("#bkQByIndent").checked, quoteWords: D.querySelector("#bkQWords").value});
  const recount = () => { D.querySelector("#bkQuoteN").textContent = quoteCount(Object.assign({}, st, readQuotes())); };
  ["#bkQByQuotes", "#bkQByIndent"].forEach(q => D.querySelector(q).addEventListener("change", recount));
  D.querySelector("#bkQWords").addEventListener("input", recount);
  D.querySelector("#bkDibGo").addEventListener("click", () => {
    Object.assign(st, readQuotes()); st.pasukAuto = D.querySelector("#bkPasukAuto").checked; st.paraJoin = pick;
    closeModal(); markDirty(); scheduleLayout(0);
    stylesSel = "dibur"; setTab("styles");
  });
  D.querySelector("#bkOk").addEventListener("click", () => {
    Object.assign(st, readQuotes());
    st.pasukAuto = D.querySelector("#bkPasukAuto").checked;
    st.paraJoin = pick;
    if(pick === "pasuk") applyPasukMode(st, dmarks.join(","));
    if(D.querySelector("#bkLikeOse").checked){ st.opener = "window"; st.openerEvery = true; }
    else if(st.opener === "window"){ st.openerEvery = false; }
    closeModal(); markDirty(); scheduleLayout(0);
    toast("ההגדרה חלה על כל הספר: " + counts[pick] + " פסקאות, " + quoteCount(st) + " ציטוטים", "ok");
  });
}
function addSections(secs, title, what){
  const hadText = hasText(book);
  const apply = (replace) => {
    if(replace) book.sections = secs;
    else{
      const onlyEmpty = book.sections.length === 1 && !book.sections[0].text.trim() && !book.sections[0].title.trim();
      book.sections = onlyEmpty ? secs : book.sections.concat(secs);
    }
    if(title && !String(book.title || "").trim()){ book.title = title; renderTop(); }
    openSec = null;
    markDirty(); renderContent(); setTab("content"); followSec = secs[0].id; scheduleLayout(0);
    toast("✓ יובא: " + what, "ok");
    if(!hadText || replace) setTimeout(paraDefAuto, 350);
  };
  if(!hadText){ apply(false); return; }
  const D = modal(`<header><h3>איפה לשים את הטקסט?</h3></header>
  <div class="bk-dbody"><div>בספר כבר יש טקסט. מה לעשות עם הטקסט החדש (${esc(what)})?</div>
  <div class="bk-choices">
    <button class="bk-choice" type="button" id="bkAppend"><b>➕ להוסיף בסוף הספר</b><small>מה שכבר כתוב נשאר</small></button>
    <button class="bk-choice" type="button" id="bkReplace"><b>🔄 להחליף את כל התוכן</b><small>הטקסט הקיים יוחלף בחדש</small></button>
  </div></div>
  <footer><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
  D.querySelector("#bkAppend").addEventListener("click", () => { closeModal(); apply(false); });
  D.querySelector("#bkReplace").addEventListener("click", () => { closeModal(); apply(true); });
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
}
function pasteDialog(){
  const D = modal(`<header><h3>📋 הדבקת טקסט</h3></header>
  <div class="bk-dbody">
    <div>הדביקו כאן (Ctrl+V) את כל הטקסט. שורות כמו <b>"פרק ב"</b> או <b>"סימן ג"</b> יהפכו לכותרות לבד.</div>
    <textarea class="bk-textarea" id="bkPasteText" dir="rtl" style="min-height:300px"></textarea>
    <label class="bk-check"><input type="checkbox" id="bkJoin"/><span>חבר שורות שבורות לפסקאות<small>מתאים לטקסט שהועתק מכתב יד או מ-PDF</small></span></label>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkOk">✓ הכנס לספר</button><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelector("#bkOk").addEventListener("click", () => {
    const text = D.querySelector("#bkPasteText").value;
    const join = D.querySelector("#bkJoin").checked;
    closeModal();
    const secs = smartSplit(text, join);
    if(!secs.length){ toast("לא הודבק טקסט", "warn"); return; }
    addSections(secs, "", secs.length + " קטעים");
  });
}
async function archiveDialog(){
  progressBox("טוען את הדפים שזוהו…");
  let runs = [];
  try{ runs = ((await call("/api/archive")).runs || []).filter(r => r.recognized); }
  catch(e){ closeModal(); toast(e.message || String(e), "err"); return; }
  if(!runs.length){ closeModal(); toast("עדיין אין דפים שזוהו בארכיון", "warn"); return; }
  const rows = runs.map((r, i) => {
    const cards = r.page_cards || [];
    const text = cards.map(c => c.text || "").join(" ").trim();
    const img = cards[0] && cards[0].preview ? `<img src="${esc(cards[0].preview)}" alt="" loading="lazy"/>` : "<img alt=\"\"/>";
    return `<label><input type="checkbox" data-i="${i}"/>${img}<span class="bk-grow"><b>${esc(r.display_name || r.title || ("דף " + (r.seq || i + 1)))}</b>
      <small>${esc(String(r.created || "").slice(0, 16).replace("T", " "))} · ${esc(text.slice(0, 80))}</small></span></label>`;
  }).join("");
  const D = modal(`<header><h3>🖼 דפים שזוהו בתוכנה</h3></header>
  <div class="bk-dbody">
    <div>סמנו את הדפים שרוצים להכניס לספר.</div>
    <div class="bk-field">איך להכניס כל דף?<div class="bk-pills" id="bkImpKind">
      <button type="button" class="bk-pill" data-k="text">כהמשך הטקסט, בלי כותרת</button>
      <button type="button" class="bk-pill" data-k="siman">כסימן, עם שם הדף ככותרת</button></div></div>
    <div class="bk-row"><button class="bk-btn bk-small" type="button" id="bkAll">סמן הכל</button><button class="bk-btn bk-small" type="button" id="bkNone">נקה סימון</button></div>
    <div class="bk-arch">${rows}</div>
    <label class="bk-check"><input type="checkbox" id="bkJoin" checked/><span>חבר את שורות כתב היד לפסקאות<small>פסקה נגמרת בשורה שמסתיימת בנקודה או בנקודתיים</small></span></label>
  </div>
  <footer><button class="bk-btn bk-primary" type="button" id="bkOk">✓ הכנס את הדפים המסומנים</button><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  // new pages come in the way the book is already built: a book of untitled text
  // parts gets untitled text, a book of simanim gets simanim (and the last choice is kept)
  const filled = book.sections.filter(s => String(s.text || "").trim());
  let impKind = book.importKind || (filled.length && filled.filter(s => s.kind === "text").length * 2 >= filled.length ? "text" : (filled.length ? "siman" : "text"));
  const syncKind = () => D.querySelectorAll("#bkImpKind [data-k]").forEach(x => x.classList.toggle("on", x.dataset.k === impKind));
  D.querySelectorAll("#bkImpKind [data-k]").forEach(x => x.addEventListener("click", () => { impKind = x.dataset.k; syncKind(); }));
  syncKind();
  D.querySelector("#bkAll").addEventListener("click", () => D.querySelectorAll(".bk-arch input").forEach(c => c.checked = true));
  D.querySelector("#bkNone").addEventListener("click", () => D.querySelectorAll(".bk-arch input").forEach(c => c.checked = false));
  D.querySelector("#bkOk").addEventListener("click", () => {
    const join = D.querySelector("#bkJoin").checked;
    const picked = [...D.querySelectorAll(".bk-arch input:checked")].map(c => runs[parseInt(c.dataset.i, 10)]);
    closeModal();
    if(!picked.length){ toast("לא סומנו דפים", "warn"); return; }
    picked.sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
    const secs = picked.map((r, i) => {
      const text = (r.page_cards || []).map(c => c.text || "").join("\n");
      const s = impKind === "text" ? {id:uid("s"), kind:"text", title:"", text: join ? joinManuscript(text) : text}
        : {id:uid("s"), kind:"siman", title:r.display_name || "", text: join ? joinManuscript(text) : text};
      // a page named "מכות ה." or "דף כד ע"ב" already says which daf it is on
      const df = dafFromName(r.display_name);
      if(df){
        s.daf = df.daf;
        if(df.amud) s.amud = df.amud;
        if(df.masechet && !book.masechet) book.masechet = df.masechet;
      }
      return s;
    });
    book.importKind = impKind;
    addSections(secs, "", secs.length + " דפים");
  });
}
function progressBox(text){
  modal(`<div class="bk-dbody bk-center" style="padding:28px"><div class="bk-spinner"></div><div style="font-size:18px;font-weight:700">${esc(text)}</div></div>`);
}

/* --------------------------------------------------------------- books */
async function showBooks(){
  await saveNow();
  progressBox("טוען את רשימת הספרים…");
  let list = [];
  try{ list = (await call("/api/book/list")).books || []; }
  catch(e){ closeModal(); toast(e.message || String(e), "err"); return; }
  const fmt = (t) => { try{ return new Date((t || 0) * 1000).toLocaleDateString("he-IL"); }catch(e){ return ""; } };
  const rows = list.map(b => `<div class="bk-item${book && b.id === book.id ? " cur" : ""}">
    <span class="bk-grow"><b>📖 ${esc(b.title || "ספר ללא שם")}</b>
    <small>${b.pages ? b.pages + " עמודים · " : ""}עודכן ${fmt(b.updated)}${book && b.id === book.id ? " · פתוח עכשיו" : ""}</small></span>
    <button class="bk-btn bk-small bk-soft" type="button" data-open="${esc(b.id)}">פתח</button>
    ${book && b.id !== book.id ? `<button class="bk-btn bk-small bk-primary" type="button" data-copystyle="${esc(b.id)}" data-title="${esc(b.title || "ספר ללא שם")}" title="הספר הפתוח עכשיו יקבל בדיוק את העיצוב של הספר הזה (הטקסט לא משתנה)">🎨 קח ממנו את העיצוב</button>` : ""}
    <button class="bk-btn bk-small" type="button" data-dup="${esc(b.id)}">שכפל</button>
    <button class="bk-btn bk-small bk-danger" type="button" data-del="${esc(b.id)}" data-title="${esc(b.title || "ספר ללא שם")}">מחק</button></div>`).join("");
  const D = modal(`<header><h3>📚 הספרים שלי</h3></header>
  <div class="bk-dbody"><button class="bk-btn bk-primary" type="button" id="bkNewBook">➕ ספר חדש</button>
  <div class="bk-list">${rows || "<div>עדיין אין ספרים שמורים.</div>"}</div></div>
  <footer><button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelector("#bkNewBook").addEventListener("click", async () => {
    closeModal();
    bookTypeDialog(async (k) => {
      const b = await newBookOfType(k);
      startBook(normalize(b)); dirty = true; saveNow();
      const T = BOOK_TYPES.find(x => x.k === k);
      toast("✓ ספר חדש: " + T.icon + " " + T.name + " — אפשר לשנות כל דבר בלשונית העיצוב", "ok");
    });
  });
  D.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => { closeModal(); openBook(b.dataset.open); }));
  D.querySelectorAll("[data-dup]").forEach(b => b.addEventListener("click", async () => {
    try{
      const src = normalize((await call("/api/book/load?id=" + encodeURIComponent(b.dataset.dup))).book);
      const copy = Object.assign(normalize(JSON.parse(JSON.stringify(src))), {id: newBook().id, title: (src.title || "ספר") + " — עותק"});
      await postJSON("/api/book/save", {book: copy});
      closeModal(); toast("נוצר עותק", "ok"); showBooks();
    }catch(e){ toast(e.message || String(e), "err"); }
  }));
  D.querySelectorAll("[data-copystyle]").forEach(b => b.addEventListener("click", () => {
    confirmBox("לקחת את העיצוב של «" + b.dataset.title + "»?",
      "הספר הפתוח עכשיו («" + esc(book.title || "ספר ללא שם") + "») יקבל את כל העיצוב שלו: גודל, גופנים, טורים, פתיחת פסקה, הזחות, דיבור המתחיל, הערות. הטקסט ועמוד השער לא משתנים.",
      "🎨 קח את העיצוב", async () => {
      try{
        const src = normalize((await call("/api/book/load?id=" + encodeURIComponent(b.dataset.copystyle))).book);
        const keepTp = st.tp, keepMeta = book.style.meta;
        book.style = Object.assign(JSON.parse(JSON.stringify(src.style)), {tp: keepTp});
        if(keepMeta !== undefined) book.style.meta = keepMeta; else delete book.style.meta;
        const id = book.id;
        closeModal();
        startBook(normalize(book));
        dirty = true; await saveNow();
        lsSet("bk_last", id);
        toast("העיצוב של «" + b.dataset.title + "» הועתק לספר הזה", "ok");
      }catch(e){ toast(e.message || String(e), "err"); }
    });
  }));
  D.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    confirmBox("למחוק את הספר?", "«" + esc(b.dataset.title) + "» יועבר לסל המחזור של התוכנה (אפשר לשחזר דרך אלי).", "🗑 מחק ספר", async () => {
      try{
        await postJSON("/api/book/delete", {id: b.dataset.del});
        if(book && book.id === b.dataset.del){ startBook(normalize(newBook())); }
        toast("הספר נמחק", "ok"); showBooks();
      }catch(e){ toast(e.message || String(e), "err"); }
    });
  }));
}
async function openBook(id){
  try{
    const res = await call("/api/book/load?id=" + encodeURIComponent(id));
    startBook(normalize(res.book));
    lsSet("bk_last", book.id);
    bumpOpenCount(book.id);
  }catch(e){ toast("לא הצלחתי לפתוח את הספר: " + (e.message || e), "err"); }
}
function startBook(b){
  book = b; st = book.style; openSec = null; dirty = false; lastPages = []; LASTP = null;
  renderRibbon();
  renderTop(); renderContent();
  if(currentTab === "design") renderDesign();
  if(currentTab === "details") renderDetails();
  setSaveState("נשמר ✓");
  $("bkViewer").innerHTML = "";
  scheduleLayout(0);
  histReset();
}

/* ----------------------------------------------------------------- PDF */
const FIT_SCRIPT = "(function(){function f(){document.querySelectorAll('.bk-page').forEach(function(p){var b=p.querySelector('.bk-body');if(!b)return;"
  + "var fl=b.querySelector('.bk-flow'),n=b.querySelector('.bk-notes');function u(){return (fl?fl.getBoundingClientRect().height:0)+(n&&!n.classList.contains('off')?n.getBoundingClientRect().height:0);}"
  + "var av=b.getBoundingClientRect().height,s=100;for(var i=0;i<8&&u()>av+0.5;i++){s-=0.6;b.style.fontSize=s+'%';}});}"
  + "if(document.fonts&&document.fonts.ready){document.fonts.ready.then(f);}else{f();}})();";
function printHTML(opt){
  if(opt && opt.booklet) return bookletHTML();
  const g = geometry(st, sideMargin(book, st));
  const B = st.cropMarks ? 12 : 0;
  const parts = [];
  for(const P of lastPages){
    const c = P.el.cloneNode(true);
    c.querySelectorAll(".bk-here").forEach(x => x.classList.remove("bk-here"));   // the screen's place mark is not printed
    c.querySelectorAll(".bk-flash").forEach(x => x.classList.remove("bk-flash"));
    // the yellow search marks are for the screen only, never for the printer
    c.querySelectorAll("mark.bk-hit").forEach(x => x.replaceWith(document.createTextNode(x.textContent)));
    if(!B){ parts.push(c.outerHTML); continue; }
    const t = 0.1, off = 3, len = B - off - 1;
    const hz = (x, y) => `<i style="position:absolute;left:${x}mm;top:${y}mm;width:${len}mm;height:0;border-top:.25pt solid #000"></i>`;
    const vt = (x, y) => `<i style="position:absolute;left:${x}mm;top:${y}mm;width:0;height:${len}mm;border-left:.25pt solid #000"></i>`;
    const W = g.W, H = g.H;
    const marks = hz(1, B) + vt(B, 1) + hz(W + B + off, B) + vt(W + B, 1)
      + hz(1, H + B) + vt(B, H + B + off) + hz(W + B + off, H + B) + vt(W + B, H + B + off);
    void t;
    parts.push(`<div class="bk-sheet"><div class="bk-sheet-in">${c.outerHTML}</div>${marks}</div>`);
  }
  const sheetCss = B ? `.bk-sheet{position:relative;width:${g.W + 2 * B}mm;height:${g.H + 2 * B}mm;overflow:hidden}
.bk-sheet-in{position:absolute;left:${B}mm;top:${B}mm}` : "";
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(book.title || "ספר")}</title>
<style>@page{size:${g.W + 2 * B}mm ${g.H + 2 * B}mm;margin:0}
html,body{margin:0;padding:0;background:#fff}
${pageCSS(st, "fonts/", {side: sideMargin(book, st)})}
.bk-page,.bk-sheet{break-after:page;page-break-after:always}
.bk-sheet .bk-page{break-after:auto;page-break-after:auto}
.bk-page:last-child,.bk-sheet:last-child{break-after:auto;page-break-after:auto}
${sheetCss}
</style></head><body>${parts.join("\n")}<script>${FIT_SCRIPT}<\/script></body></html>`;
}
// B5: a booklet for folding and stapling. The pages are padded to a multiple of 4 and laid two
// on a landscape sheet in the order a right-to-left booklet needs: printed on both sides (flip on
// the short edge), folded in the middle, the pages come out in order.
function bookletHTML(){
  const g = geometry(st, sideMargin(book, st));
  const pages = lastPages.map(P => {
    const c = P.el.cloneNode(true);
    c.querySelectorAll(".bk-here").forEach(x => x.classList.remove("bk-here"));   // the screen's place mark is not printed
    c.querySelectorAll(".bk-flash").forEach(x => x.classList.remove("bk-flash"));
    c.querySelectorAll("mark.bk-hit").forEach(x => x.replaceWith(document.createTextNode(x.textContent)));
    return c.outerHTML;
  });
  const blank = `<div class="bk-page even bk-blank"></div>`;
  while(pages.length % 4) pages.push(blank);
  const n = pages.length, sheets = [];
  for(let s = 0; s < n / 4; s++){
    // 1-based page numbers on each side of sheet s: [left, right]
    sheets.push([n - 2 * s, 1 + 2 * s], [2 + 2 * s, n - 1 - 2 * s]);
  }
  const body = sheets.map(([l, r]) => `<div class="bk-bsheet"><div class="bk-bhalf">${pages[l - 1]}</div><div class="bk-bhalf">${pages[r - 1]}</div></div>`).join("\n");
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(book.title || "ספר")} — חוברת</title>
<style>@page{size:${2 * g.W}mm ${g.H}mm;margin:0}
html,body{margin:0;padding:0;background:#fff}
${pageCSS(st, "fonts/", {side: sideMargin(book, st)})}
.bk-bsheet{display:flex;direction:ltr;width:${2 * g.W}mm;height:${g.H}mm;overflow:hidden;break-after:page;page-break-after:always}
.bk-bsheet:last-child{break-after:auto;page-break-after:auto}
.bk-bhalf{width:${g.W}mm;height:${g.H}mm;overflow:hidden;direction:rtl}
.bk-bhalf .bk-page{break-after:auto;page-break-after:auto}
.bk-blank{width:${g.W}mm;height:${g.H}mm}
</style></head><body>${body}<script>${FIT_SCRIPT}<\/script></body></html>`;
}
function pdfKindDialog(){
  return new Promise(res => {
    const D = modal(`<header><h3>📄 הפקת PDF</h3></header><div class="bk-dbody"><div class="bk-choices">
      <button class="bk-choice" type="button" data-pk="book"><b>📖 ספר רגיל</b><small>עמוד אחרי עמוד, לבית הדפוס או להדפסה רגילה</small></button>
      <button class="bk-choice" type="button" data-pk="booklet"><b>📰 חוברת לקיפול</b><small>שני עמודים על כל צד של דף לרוחב. מדפיסים דו־צדדי (היפוך בצד הקצר), מקפלים באמצע — והעמודים בסדר</small></button>
    </div></div><footer><button class="bk-btn" type="button" id="bkCancel">ביטול</button></footer>`);
    D.querySelector("#bkCancel").addEventListener("click", () => { closeModal(); res(null); });
    D.querySelectorAll("[data-pk]").forEach(b => b.addEventListener("click", () => { closeModal(); res(b.dataset.pk); }));
  });
}
// B6: the book as a Word file — the paragraphs exactly as the book divides them
async function exportDocx(){
  if(!book) return;
  await saveNow();
  progressBox("מכין קובץ Word…");
  try{
    let chap = 0, sim = 0;
    const sections = book.sections.map(sec => {
      const label = st.autoNumber ? (sec.kind === "chapter" ? (st.chapterWord || "פרק") + " " + gem(++chap) : sec.kind === "siman" ? (st.simanWord || "סימן") + " " + gem(++sim) : "") : "";
      return {kind: sec.kind, title: sec.title || "", label, paras: paraLines(sec.text, st).map(x => x[0].replace(/[\u0004\u0005]/g, "")).filter(x => x.trim())};
    });
    const res = await postJSON("/api/book/docx", {name: book.title || "ספר", title: book.title || "", subtitle: book.subtitle || "", author: book.author || "", sections});
    if(res.cancelled){ closeModal(); return; }
    const D = modal(`<header><h3>✓ קובץ ה-Word מוכן</h3></header><div class="bk-dbody">
      <div class="bk-ok" style="font-size:19px">${res.paragraphs} פסקאות ו־${res.notes} הערות שוליים.</div>
      <div>המקום: <span dir="ltr" style="word-break:break-all">${esc(res.path || "")}</span></div></div>
      <footer><button class="bk-btn bk-primary" type="button" id="bkOpenDoc">📝 פתח את הקובץ</button><button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
    D.querySelector("#bkCancel").addEventListener("click", closeModal);
    D.querySelector("#bkOpenDoc").addEventListener("click", () => postJSON("/api/book/open", {path: res.path}).catch(e => toast(e.message, "err")));
  }catch(e){ closeModal(); toast("לא הצלחתי ליצור קובץ Word: " + (e.message || e), "err"); }
}
async function exportPdf(){
  if(!book) return;
  const kind = await pdfKindDialog();
  if(!kind) return;
  await saveNow();
  progressBox("מכין את הספר להדפסה…");
  await waitLayout();
  if(!lastPages.length){ closeModal(); toast("עדיין אין עמודים להדפסה — הכניסו טקסט", "warn"); return; }
  progressBox("יוצר קובץ PDF של " + lastPages.length + " עמודים… (זה יכול לקחת חצי דקה)");
  try{
    const res = await postJSON("/api/book/pdf", {html: printHTML({booklet: kind === "booklet"}), name: (book.title || "ספר") + (kind === "booklet" ? " — חוברת" : ""), pages: lastPages.length});
    if(res.cancelled){ closeModal(); return; }
    const D = modal(`<header><h3>✓ קובץ ה-PDF מוכן</h3></header>
    <div class="bk-dbody"><div class="bk-ok" style="font-size:19px">הספר נשמר כקובץ PDF — ${res.pages || lastPages.length} עמודים.</div>
    <div>המקום: <span dir="ltr" style="word-break:break-all">${esc(res.path || "")}</span></div>
    <div>${res.opened ? "הקובץ נפתח עכשיו. אפשר להדפיס אותו משם (Ctrl+P), או לשלוח אותו לבית הדפוס." : "אפשר לפתוח אותו ולהדפיס, או לשלוח לבית הדפוס."}</div></div>
    <footer><button class="bk-btn bk-primary" type="button" id="bkOpenPdf">📄 פתח את הקובץ</button>
    <button class="bk-btn" type="button" id="bkOpenDir">📂 פתח את התיקייה</button>
    <button class="bk-btn" type="button" id="bkCancel">סגור</button></footer>`);
    D.querySelector("#bkCancel").addEventListener("click", closeModal);
    D.querySelector("#bkOpenPdf").addEventListener("click", () => postJSON("/api/book/open", {path: res.path}).catch(e => toast(e.message, "err")));
    D.querySelector("#bkOpenDir").addEventListener("click", () => postJSON("/api/book/open", {path: res.path, folder: true}).catch(e => toast(e.message, "err")));
  }catch(e){
    closeModal();
    toast("לא הצלחתי ליצור PDF: " + (e.message || e), "err");
  }
}

/* --------------------------------------------------------------- sample */
function loadSample(){
  const S = (kind, title, text) => ({id:uid("s"), kind, title, text});
  book.title = book.title || "ספר לדוגמה";
  book.subtitle = book.subtitle || "דברים בעניני תלמוד תורה";
  book.author = book.author || "סודר בעזרת השי\"ת";
  book.year = book.year || "תשפ\"ז";
  book.sections = [
    S("intro", "הקדמה", [
      "ברוך ה' שהחייני וקיימני לסדר את הדברים האלו, אשר נאמרו בשיעורים בבית המדרש במשך השנים{הדברים נכתבו בקיצור, ומי שירצה להרחיב ימצא את המקורות בפנים.}. כוונתי היתה לקבץ את עיקרי הדברים בסדר נוח, כדי שיהיו לעזר ללומדים, ושיוכלו למצוא בנקל את מבוקשם.",
      "ותפילתי שלא תצא תקלה מתחת ידי, ושנזכה להגדיל תורה ולהאדירה, ולראות בנחמת ציון וירושלים.",
    ].join("\n")),
    S("chapter", "בגדר מצות תלמוד תורה", ""),
    S("siman", "חיוב הלימוד בכל יום", [
      "מצות תלמוד תורה היא מן המצוות התדירות, ואין לה שיעור קבוע{עיין במשנה ריש מסכת פאה, שמנתה את תלמוד תורה בין הדברים שאין להם שיעור, ושכנגד כולם.}. ואמרו חז\"ל שאפילו פרק אחד שחרית ופרק אחד ערבית מקיים בזה \"והגית בו יומם ולילה\" (מנחות צט:).",
      "ונראה לבאר{{ראה גם בשו\"ע הרב, הלכות תלמוד תורה פרק ג.}} שיש בזה שני חלקים: חלק אחד הוא עצם החיוב ללמוד, וחלק שני הוא הקביעות, שיהיה לאדם זמן קבוע לתורה שאינו זז ממנו{וכן מבואר בגמרא (שבת לא.) ששואלים את האדם \"קבעת עתים לתורה\", ומשמע שהקביעות היא ענין בפני עצמו, נוסף על עצם הלימוד. ויש לעיין אם חיוב הקביעות הוא מדאורייתא או מדרבנן, ויש בזה כמה שיטות בראשונים, ואכמ\"ל.}.",
      "*ויש להוסיף* שהקביעות מועילה גם לזכירת הלימוד, שהלומד בזמן קבוע ובמקום קבוע תלמודו מתקיים בידו (עיין עירובין נד:). ולכן נהגו רבים לקבוע שיעור קבוע אחר התפילה, ושיעור נוסף בערב{והמנהג הפשוט בהרבה קהילות לקבוע לימוד בין מנחה למעריב, שאז רוב הציבור נמצא בבית הכנסת.}.",
      "= ואשרי מי שעמלו בתורה",
    ].join("\n")),
    S("siman", "לימוד מתוך הספר", [
      "נוהגים לומר שהלומד מתוך הספר זוכר יותר מהלומד בעל פה, ולכן טוב להרגיל את התלמידים לעיין בספרים בעצמם{וזה אחד הטעמים שנהגו להדפיס את הספרים בצורה מסודרת וברורה, שיהיה קל לעיין בהם ולמצוא כל דבר במקומו. ומטעם זה הקפידו המדפיסים הראשונים על צורת הדף, שתהיה שווה בכל ההוצאות, כדי שהלומד יכיר את מקום הדברים, ויש שזוכרים את הדברים לפי מקומם בדף. ובאמת יש בזה תועלת גדולה לזכירה, כמו שכתבו כמה מהאחרונים, ועיין עוד במה שכתבנו לקמן בסימן הבא.}. ומכל מקום ראוי לחזור על הדברים בעל פה, כדי שיהיו שגורים בפיו.",
      "***",
      "ובאמת כל אחד לפי דרכו וכחו, והעיקר שיהיה הלימוד מתוך שמחה ומתוך יראת שמים{{עיין אבות פרק ג משנה ט.}}, ושיהיה הלימוד על מנת לעשות ולקיים.",
    ].join("\n")),
    S("chapter", "בדין חזרה על הלימוד", ""),
    S("siman", "מעלת החזרה", [
      "[[גודל המעלה]] א. גדולה מעלת החזרה על הלימוד, שאמרו אינו דומה שונה פרקו מאה פעמים לשונה פרקו מאה ואחד (חגיגה ט:){ופירשו המפרשים שהפעם הנוספת היא שמראה שהלומד אינו לומד מתוך הרגל בלבד, אלא מתוך אהבת התורה.}. ומכאן שיש להקפיד לחזור על כל דבר שלומדים, ולא להסתפק בלימוד אחד.",
      "[[זמני החזרה]] ב. יש שנהגו לחזור על הלימוד בסוף כל שבוע, ויש שחוזרים בסוף כל חודש. וכל המרבה הרי זה משובח, ובלבד שלא יבוא על ידי זה לביטול לימוד חדש{שהרי צריך לחלק את זמנו בין לימוד חדש לחזרה, וכבר האריכו בזה בספרי המוסר.}.",
      "(א) החוזר בכל יום מעט, תלמודו מתקיים בידו יותר מן החוזר הרבה בבת אחת.",
      "(ב) טוב לקבוע את החזרה בזמן קבוע, כדי שלא תשתכח.",
      "[[כתיבת הדברים]] ג. *וטוב לרשום* את עיקרי הדברים בקצרה, כדי שיהיה קל לחזור עליהם. והרושם את הדברים בכתב ידו, זוכרם יותר ממי שרק שומע או קורא{{עיין עירובין נד.}}.",
    ].join("\n")),
  ];
  openSec = null;
  markDirty(); renderTop(); renderContent(); setTab("content"); scheduleLayout(0);
  toast("נטען ספר לדוגמה — נסו לשנות סגנון בלשונית \"עיצוב\"", "ok");
}

/* ------------------------------------------------------------ open/close */
async function open(){
  if(!ROOT){ buildDOM(); wireRibbon(); await loadFontCatalog(); }
  ROOT.classList.add("on");
  document.documentElement.classList.add("bk-open-studio");
  applyZoomCompensation();
  syncViewBar();
  if(!book){
    const last = lsGet("bk_last", "");
    let loaded = false;
    if(last){
      try{ const res = await call("/api/book/load?id=" + encodeURIComponent(last)); startBook(normalize(res.book)); loaded = true; bumpOpenCount(book.id); }catch(e){}
    }
    if(!loaded){
      let list = [];
      try{ list = (await call("/api/book/list")).books || []; }catch(e){}
      if(list.length){ await openBook(list[0].id); }
      else { startBook(normalize(newBook())); }
    }
  }else{
    showPages();
    if(needLayout || !lastPages.length) scheduleLayout(0);
  }
}
async function close(){
  try{ await saveNow(); }catch(e){}
  if(ROOT) ROOT.classList.remove("on");
  document.documentElement.classList.remove("bk-open-studio");
}
function init(o){
  APP = Object.assign({}, APP, o || {});
}
window.BookStudio = {init, open, close,
  _test: {gem, dafLabel, dafFromName, parseInline, buildBlocks, paraLines, ownLines, layoutBook, pageCSS, smartSplit, joinManuscript, geometry, SEC_LOOKS, SEC_LOOK_CLS,
    DEFAULT_STYLE, TEMPLATES, get book(){ return book; }, get pages(){ return lastPages; }, loadSample,
    relayout, waitLayout, printHTML, setStyle(o){ Object.assign(st, o); return relayout(); }, startBook, newBook, normalize}};

// v1.8.97 (Abba 11-03): a word or letter marked in the text offers: to style it, or to start a new part / heading there
function selChipHide(){ const c = document.getElementById("bkSelChip"); if(c) c.remove(); }
document.addEventListener("mouseup", e => {
  const ta = e.target.closest && e.target.closest(".bk-sec.open textarea");
  if(!ta || !ROOT || !ROOT.contains(ta)) return;
  setTimeout(() => {
    selChipHide();
    if(ta.selectionEnd <= ta.selectionStart) return;
    const c = h("div", {class:"bk-selchip", id:"bkSelChip", role:"menu"});
    c.innerHTML = `<b>מה לעשות במה שסימנת?</b>
      <button type="button" data-chip="look">🎨 לעצב (גופן, גודל, צבע)</button>
      <button type="button" data-chip="split">✂ מכאן קטע חדש</button>
      <button type="button" data-chip="head">➕ כותרת כאן</button>
      <button type="button" class="bk-popx" data-chip="x" title="סגור" aria-label="סגור">✕</button>`;
    c.style.left = Math.max(8, Math.min(window.innerWidth - 300, e.clientX - 140)) + "px";
    c.style.top = Math.min(window.innerHeight - 70, e.clientY + 16) + "px";
    document.body.appendChild(c);
    c.addEventListener("mousedown", ev => ev.preventDefault());
    c.addEventListener("click", ev => {
      const b = ev.target.closest("[data-chip]"); if(!b) return; const k = b.dataset.chip; selChipHide();
      if(k === "look"){ const r = ROOT.querySelector("#bkRibbon [data-rib='selfont']"); ta.focus(); if(r) r.click(); else toast("סרגל הכלים מוסתר — אפשר להציג אותו בתפריט", "warn"); }
      else if(k === "split"){ ta.focus(); ta.setSelectionRange(ta.selectionStart, ta.selectionStart); const s = ta.closest(".bk-sec").querySelector("[data-act='split']"); if(s) s.click(); }
      else if(k === "head"){ ta.focus(); ta.setSelectionRange(ta.selectionStart, ta.selectionStart); const P = ribPara(); if(P) headingHere(P.sec, P.ln, 2); }
    });
  }, 0);
});
document.addEventListener("mousedown", e => { if(!e.target.closest || !e.target.closest("#bkSelChip")) selChipHide(); }, true);
document.addEventListener("keydown", e => { selChipHide(); if(e.key === "Escape") hidePop(); });
document.addEventListener("scroll", () => selChipHide(), true);

// v1.8.98 (Eli 11-03: "מגירת עיטורים יפים להפרדה בין פסקאות — ברמה גרפית מעוצבת"):
// drawn dividers (vector, sharp in print). Each = the RIGHT half from the centre (x=200) outwards, mirrored,
// plus an optional centre piece. viewBox 400×48, centre line y=24. Colour = the text colour.
const ORN_TAPER = (x0, x1, w) => `<path d="M${x0} ${24 - w}C${(x0 + x1) / 2} ${24 - w * 0.55} ${x1 - 20} ${24 - 0.25} ${x1} 24C${x1 - 20} ${24 + 0.25} ${(x0 + x1) / 2} ${24 + w * 0.55} ${x0} ${24 + w}Z"/>`;
const ORN_LEAF = (x, y, l, a, w) => `<path transform="translate(${x} ${y}) rotate(${a})" d="M0 0C${l * 0.3} ${-w} ${l * 0.75} ${-w} ${l} 0C${l * 0.75} ${w} ${l * 0.3} ${w} 0 0Z"/>`;
const ORN_DOT = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const ORN_CURL = (x, y, r, dir, sw) => `<path fill="none" stroke="currentColor" stroke-width="${sw || 1.6}" stroke-linecap="round" d="M${x} ${y}c0 ${-r * dir} ${r * 1.4} ${-r * dir} ${r * 1.4} ${-r * 0.1 * dir}c0 ${r * 0.75 * dir} ${-r} ${r * 0.8 * dir} ${-r} ${r * 0.15 * dir}c0 ${-r * 0.35 * dir} ${r * 0.55 * dir * dir} ${-r * 0.4 * dir} ${r * 0.6} ${-r * 0.05 * dir}"/>`;
const ORN_DIV = {
  // a long tapering swell, a lozenge in the middle — the classic "English rule"
  swell: {name:"קו מתעבה", half: ORN_TAPER(212, 392, 2.2), mid: `<path d="M200 15L208 24L200 33L192 24Z"/>` + ORN_DOT(200, 24, 0)},
  // two thin lines, pearls, a hollow diamond
  pearls: {name:"פנינים", half: `<path d="M214 22.6H360M214 25.4H360" stroke="currentColor" stroke-width=".9" fill="none"/>` + [366, 374, 381, 387, 392].map((x, i) => ORN_DOT(x, 24, 2.2 - i * 0.38)).join(""),
           mid: `<path d="M200 13L211 24L200 35L189 24Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M200 19L205 24L200 29L195 24Z"/>`},
  // a vine: a wave with curls and leaves, a rosette in the middle
  vine: {name:"גפן מסתלסלת", half: `<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M212 24C232 12 252 12 268 24S304 36 322 24S356 12 372 22C380 27 388 25 392 21"/>`
           + ORN_CURL(240, 15, 7, 1, 1.2) + ORN_CURL(296, 33, 7, -1, 1.2) + ORN_CURL(348, 15, 6, 1, 1.2)
           + ORN_LEAF(262, 21, 13, -40, 4) + ORN_LEAF(316, 27, 13, 40, 4) + ORN_LEAF(366, 21, 11, -35, 3.4),
         mid: [0, 60, 120, 180, 240, 300].map(a => ORN_LEAF(200, 24, 10, a, 3.6)).join("") + `<circle cx="200" cy="24" r="3.2" fill="#fff"/><circle cx="200" cy="24" r="1.8"/>`},
  // baroque: C-scrolls back to back, a fleuron in the middle
  baroque: {name:"בארוק", half: `<g fill="none" stroke="currentColor" stroke-linecap="round"><path stroke-width="2" d="M214 24C226 24 232 14 244 14C256 14 258 26 248 27C241 28 240 20 246 20"/>`
           + `<path stroke-width="2" d="M244 14C262 14 270 34 290 34C306 34 312 22 304 18C297 15 293 23 299 25"/>`
           + `<path stroke-width="1.2" d="M290 34C312 34 330 24 392 24"/></g>` + ORN_LEAF(330, 26, 16, -12, 3.2) + ORN_DOT(392, 24, 1.6),
            mid: `<path d="M200 8C205 15 209 19 209 24C209 30 204 33 200 40C196 33 191 30 191 24C191 19 195 15 200 8Z"/><circle cx="200" cy="24" r="2.4" fill="#fff"/>`},
  // three leaves fanning from the centre, long fine lines
  leaves: {name:"עלים", half: `<path d="M226 24H392" stroke="currentColor" stroke-width=".8"/>` + ORN_TAPER(226, 330, 1.4) + ORN_LEAF(204, 24, 20, -18, 5) + ORN_LEAF(204, 24, 16, 22, 4) + ORN_LEAF(340, 24, 9, -30, 2.6) + ORN_LEAF(340, 24, 9, 30, 2.6),
           mid: ORN_LEAF(200, 26, 16, -90, 5) + ORN_DOT(200, 30, 2)},
  // a Star of David between two tapering rules
  magen: {name:"מגן דוד", half: ORN_TAPER(220, 392, 1.8) + ORN_DOT(226, 24, 0),
          mid: `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M200 11L211.3 30.5H188.7Z"/><path d="M200 37L188.7 17.5H211.3Z"/></g>`},
  // a twisted rope (two intertwined waves), knots at the ends
  rope: {name:"חבל שזור", half: `<g fill="none" stroke="currentColor" stroke-width="1.4"><path d="M212 24${Array.from({length: 9}, (_, i) => `Q${216 + i * 20} ${i % 2 ? 31 : 17} ${226 + i * 20} 24`).join("")}"/>`
           + `<path d="M212 24${Array.from({length: 9}, (_, i) => `Q${216 + i * 20} ${i % 2 ? 17 : 31} ${226 + i * 20} 24`).join("")}"/></g>` + ORN_DOT(392, 24, 2.4),
         mid: `<circle cx="200" cy="24" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="200" cy="24" r="3.4"/>`},
  // a crown of arcs (like the head of a Torah crown) with fine rules
  crown: {name:"כתר", half: `<path d="M226 24H392" stroke="currentColor" stroke-width="1"/><path d="M226 21H330" stroke="currentColor" stroke-width=".6"/><path d="M226 27H330" stroke="currentColor" stroke-width=".6"/>` + ORN_DOT(336, 24, 2) + ORN_DOT(344, 24, 1.4),
          mid: `<path d="M184 32H216L219 16L210 24L200 10L190 24L181 16Z"/>` + ORN_DOT(181, 14, 2) + ORN_DOT(200, 8, 2.2) + ORN_DOT(219, 14, 2)},
  // tendrils: a spiral at each side, dots tapering out
  spiral: {name:"סלסולים", half: `<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M206 24C214 24 220 18 228 18C238 18 240 30 230 30C224 30 224 22 230 23"/>`
           + `<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M228 18C246 16 252 30 268 30C280 30 284 20 276 18C271 17 269 23 274 24"/>` + ORN_TAPER(268, 380, 1.3) + [386, 392].map((x, i) => ORN_DOT(x, 24, 1.6 - i * 0.5)).join(""),
           mid: ORN_DOT(200, 24, 3)},
  // a lotus in the middle, petals; thin double rule out to the sides
  lotus: {name:"פרח", half: `<path d="M222 22.8H392M222 25.2H360" stroke="currentColor" stroke-width=".8"/>` + ORN_LEAF(214, 24, 12, 0, 3.5),
          mid: ORN_LEAF(200, 30, 20, -90, 6) + ORN_LEAF(200, 30, 16, -130, 4.6) + ORN_LEAF(200, 30, 16, -50, 4.6) + ORN_LEAF(200, 30, 11, -165, 3) + ORN_LEAF(200, 30, 11, -15, 3)},
};

// engraved swashes (Eli's sample 11-03): a calligraphic arm that swells and tapers, fine hairlines riding along it,
// a small loop at the centre — the look of a copper-engraved book ornament
// one arm: from the centre it rises, then sweeps down and out to a fine point
const ORN_SWASH = (opt) => {
  const o = Object.assign({w: 5, hair: 3}, opt || {});
  let s = `<path d="M207 22C228 6 266 9 300 22C330 33 364 31 394 21C364 ${33 + o.w * 0.5} 330 ${35 + o.w * 0.6} 298 ${25 + o.w * 0.5}C266 ${14 + o.w * 0.3} 230 ${12 + o.w * 0.2} 207 22Z"/>`;
  // hairlines: the arm's own curve, lifted a little and trimmed at both ends, each one lighter — engraver's shading
  const edge = "M207 22C228 6 266 9 300 22C330 33 364 31 394 21";
  for(let i = 1; i <= o.hair; i++)
    s += `<path fill="none" stroke="currentColor" stroke-width="${(0.75 - i * 0.1).toFixed(2)}" stroke-linecap="round" opacity="${(1 - i * 0.14).toFixed(2)}" transform="translate(${i * 1.5} ${-i * 2.4})" stroke-dasharray="0 ${14 + i * 10} ${120 - i * 18} 999" d="${edge}"/>`;
  return s;
};
// the centre: a small open loop where the two arms meet, a pearl under it
const ORN_LOOP = `<path fill="none" stroke="currentColor" stroke-width="1.4" d="M207 22C203 26 197 26 193 22C189 17 194 11 200 11C206 11 211 17 207 22Z"/>` + `<circle cx="200" cy="29" r="1.9"/>`;
Object.assign(ORN_DIV, {
  engraved: {name:"חריטה עדינה", half: ORN_SWASH(), mid: ORN_LOOP},
  engraved2: {name:"חריטה עשירה", half: ORN_SWASH({w: 7, hair: 4}) + ORN_LEAF(318, 33, 12, 18, 2.8) + ORN_DOT(398, 20, 1.3), mid: ORN_LOOP + ORN_DOT(200, 7, 1.8)},
  engraved3: {name:"חריטה עם פרח", half: ORN_SWASH({w: 4, hair: 2}), mid: ORN_LEAF(200, 24, 14, -90, 4.4) + ORN_LEAF(200, 24, 11, -145, 3.2) + ORN_LEAF(200, 24, 11, -35, 3.2) + ORN_DOT(200, 29, 2)},
});
const ORN_IDS = Object.keys(ORN_DIV);
// the traced ornaments (src/book_ornaments.json — real engraved artwork turned into one vector path each) load once;
// a page that asks for one before they arrive is laid out again when they do
let ORN_LOAD = null, ORN_PARTS = null, ORN_GEN = 0;   // ORN_GEN: bumps when the real ornaments arrive (the layout cache keys on it)
function ornLoad(){
  if(ORN_LOAD) return ORN_LOAD;
  ORN_LOAD = fetch("/book/ornaments.json", {cache:"no-store"}).then(r => r.ok ? r.json() : {}).then(J => {
    let n = 0; for(const k of Object.keys(J || {})){ if(k === "_parts"){ ORN_PARTS = J[k]; n++; continue; } if(k.startsWith("_")) continue; if(!ORN_DIV[k]){ ORN_DIV[k] = J[k]; n++; } }
    if(n) ORN_GEN++;
    const real = Object.keys(ORN_DIV).filter(k => ORN_DIV[k].d || ORN_DIV[k].g);
    ORN_IDS.splice(0, ORN_IDS.length, ...(real.length ? real : Object.keys(ORN_DIV)));
    if(n && typeof scheduleLayout === "function") scheduleLayout(0);
  }).catch(() => {});
  return ORN_LOAD;
}
function ornSvg(id, h){
  const D = ORN_DIV[id]; if(!D){ ornLoad(); return ""; }
  if(D.d || D.g){   // a traced / composed one: the picture's own proportions, the width decides the size
    const [w, hh] = D.vb || [400, 48];
    return `<svg class="bk-ornsvg bk-orntr" viewBox="0 0 ${w} ${hh}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" fill="currentColor">${D.g || `<path fill-rule="evenodd" d="${D.d}"/>`}</svg>`;
  }
  const vb = D.vb || 48;
  return `<svg class="bk-ornsvg" viewBox="0 0 400 ${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="height:${(h || 1.6) * vb / 48}em" fill="currentColor">`
    + `<g>${D.half}</g><g transform="translate(400 0) scale(-1 1)">${D.half}</g>${D.mid || ""}</svg>`;
}

// v1.8.98 (Eli's samples 11-03): drawn scrolls for headings — a curl made of a true spiral, and bands of them
function ornSpiral(cx, cy, r, turns, dir, phase){
  const n = Math.round(turns * 28), pts = [];
  for(let i = 0; i <= n; i++){
    const f = i / n, a = phase + dir * f * turns * Math.PI * 2, rr = r * (1 - f * 0.82);
    pts.push((cx + rr * Math.cos(a)).toFixed(2) + " " + (cy + rr * Math.sin(a)).toFixed(2));
  }
  return "M" + pts.join("L");
}
// one scroll: an S-stroke leaving from (x0,24) outwards, rolling into a spiral up or down
function ornScroll(x0, len, up, r, sw){
  const cx = x0 + len, cy = 24 + (up ? -r : r) * 0.95, s = up ? -1 : 1;
  const stroke = `M${x0} 24C${x0 + len * 0.45} 24 ${cx - r * 1.2} ${24 + s * r * 2.1} ${cx} ${24 + s * r * 1.9}`;
  return `<path d="${stroke}${ornSpiral(cx, cy, r * 0.95, 1.6, up ? -1 : 1, up ? Math.PI / 2 : -Math.PI / 2).replace("M", "L")}" fill="none" stroke="currentColor" stroke-width="${sw || 1.7}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
// a band of scrolls (top/bottom of the frame, or a divider): a finial in the middle, scrolls alternating outwards
function ornBand(opt){
  const o = Object.assign({n: 3, r: 7, gap: 34}, opt || {});
  let half = "";
  for(let i = 0; i < o.n; i++){ const x = 210 + i * o.gap, rr = o.r * (1 - i * 0.16); half += ornScroll(x, o.gap * 0.62, i % 2 === 0, rr); }
  half += `<circle cx="${210 + o.n * o.gap - 6}" cy="24" r="2"/>`;
  const mid = `<path d="M200 5C203 12 207 15 207 20C207 25 203 27 200 32C197 27 193 25 193 20C193 15 197 12 200 5Z"/><circle cx="200" cy="38" r="2.2"/>`;
  return {half, mid};
}
// the curl beside a number: "∘ꝏ א ꝏ∘" — two spirals joined by an S, a pearl at the end (right side; mirrored for the left)
function ornCurlSide(left){
  if(ORN_PARTS && ORN_PARTS.arm){
    // the traced arm (x 192..398 of a 400-wide picture), its mouth towards the number
    const [x0, x1, y0, y1] = ORN_PARTS.armbox, w = x1 - x0 + 4, h = y1 - y0 + 2;
    return `<svg class="bk-curl bk-curltr" viewBox="0 0 ${w} ${h}" aria-hidden="true" fill="currentColor"><g${left ? ` transform="translate(${w} 0) scale(-1 1)"` : ""}><path fill-rule="evenodd" transform="translate(${-x0 + 2} ${-y0 + 1})" d="${ORN_PARTS.arm}"/></g></svg>`;
  }
  ornLoad();
  const g = ornRinceau({x0: 8, n: 2, gap: 26, A: 6, R: 6, sw: 1.8});
  return `<svg class="bk-curl" viewBox="0 0 76 48" aria-hidden="true" fill="currentColor"><g${left ? "" : ' transform="translate(76 0) scale(-1 1)"'}>${g}</g></svg>`;
}
function ornCartouche(titleHtml){
  if(ORN_PARTS && ORN_PARTS.arm){
    // bands above and below = the whole flourish (both arms); the sides = the arm standing upright
    const A = ORN_PARTS.arm, [x0, x1, y0, y1] = ORN_PARTS.armbox;
    const both = `<path fill-rule="evenodd" d="${A}"/><path fill-rule="evenodd" transform="translate(400 0) scale(-1 1)" d="${A}"/>`;
    const band = (flip) => `<svg class="bk-cartband" viewBox="0 0 400 72" aria-hidden="true" fill="currentColor"${flip ? ' style="transform:scaleY(-1)"' : ""}>${both}</svg>`;
    const end = (left) => `<svg class="bk-cartend bk-cartendtr" viewBox="0 0 72 210" aria-hidden="true" fill="currentColor"><g transform="${left ? "translate(72 0) scale(-1 1) " : ""}translate(0 210) rotate(-90)"><path fill-rule="evenodd" transform="translate(${-x0} ${-y0}) " d="${A}"/></g></svg>`;
    return `<span class="bk-cart bk-carttr">${band(false)}<span class="bk-cartrow">${end(false)}<span class="bk-cartbox">${titleHtml}</span>${end(true)}</span>${band(true)}</span>`;
  }
  ornLoad();
  const half = ornRinceau({n: 4, gap: 36, A: 6.5, R: 6.6});
  const band = (flip) => `<svg class="bk-cartband" viewBox="0 0 400 48" aria-hidden="true" fill="currentColor"${flip ? ' style="transform:scaleY(-1)"' : ""}><g>${half}</g><g transform="translate(400 0) scale(-1 1)">${half}</g>${ornRosette(200, 24, 9)}</svg>`;
  const end = (left) => `<svg class="bk-cartend" viewBox="0 0 40 64" aria-hidden="true" fill="currentColor"><g${left ? ' transform="translate(40 0) scale(-1 1)"' : ""}>`
    + `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M38 32C30 32 26 22 18 19${ornSpiral(13, 24, 6.5, 1.6, -1, -Math.PI / 2 + 0.3).replace("M", "L")}"/>`
    + `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M38 32C30 32 26 42 18 45${ornSpiral(13, 40, 6.5, 1.6, 1, Math.PI / 2 - 0.3).replace("M", "L")}"/>`
    + ORN_LEAF(30, 32, 14, 180, 4) + `<circle cx="9" cy="32" r="2.4"/></g></svg>`;
  return `<span class="bk-cart">${band(false)}<span class="bk-cartrow">${end(false)}<span class="bk-cartbox">${titleHtml}</span>${end(true)}</span>${band(true)}</span>`;
}
// a rinceau: ONE continuous wave from the centre outwards; from each crest a tendril grows on, tangent-true, into a spiral
function ornRinceau(o){
  o = Object.assign({x0: 214, n: 3, gap: 30, A: 7, R: 6.5, sw: 1.7, tail: 0}, o || {});
  let wave = `M${o.x0 - 6} 24C${o.x0} 24 ${o.x0 + o.gap * 0.2} ${24 - o.A} ${o.x0 + o.gap * 0.5} ${24 - o.A}`, tend = "", leaves = "";
  const crest = (i) => [o.x0 + o.gap * (i + 0.5), 24 + (i % 2 ? o.A : -o.A)];
  for(let i = 0; i < o.n; i++){
    const [x, y] = crest(i), up = i % 2 === 0, R = o.R * (1 - i * 0.12), s = up ? 1 : -1;
    if(i < o.n - 1){ const [x2, y2] = crest(i + 1); wave += `C${x + o.gap * 0.5} ${y} ${x2 - o.gap * 0.5} ${y2} ${x2} ${y2}`; }
    // the tendril: from the crest forward, then down (or up) into the hollow and around
    const c = [x + o.gap * 0.34, y - s * R * 1.0], a0 = up ? Math.PI / 2 : -Math.PI / 2, dir = up ? -1 : 1;
    const p0 = [c[0] + R * Math.cos(a0), c[1] + R * Math.sin(a0)];
    tend += `<path d="M${x - o.gap * 0.12} ${y}C${x} ${y} ${p0[0] - R * 0.7} ${p0[1]} ${p0[0]} ${p0[1]}${ornSpiral(c[0], c[1], R, 1.55, dir, a0).replace("M", "L")}" fill="none" stroke="currentColor" stroke-width="${(o.sw * 0.85).toFixed(2)}" stroke-linecap="round"/>`;
    leaves += ORN_LEAF(x + o.gap * 0.3, y + s * 1.2, R * 1.45, up ? 28 : -28, R * 0.4);
  }
  const [xe, ye] = crest(o.n - 1);
  wave += `C${xe + o.gap * 0.4} ${ye} ${xe + o.gap * 0.5} 24 ${xe + o.gap * 0.9} 24`;
  let tail = o.tail ? `<path d="M${xe + o.gap * 0.9} 24H${o.tail}" stroke="currentColor" stroke-width="${o.sw * 0.6}"/>` : `<circle cx="${xe + o.gap * 0.95}" cy="24" r="1.9"/>`;
  return `<path d="${wave}" fill="none" stroke="currentColor" stroke-width="${o.sw}" stroke-linecap="round"/>` + tend + leaves + tail;
}
// a rosette: eight petals, each with a light vein, a ring and a pearl
function ornRosette(cx, cy, r){
  let s = "";
  for(let i = 0; i < 8; i++){ const a = i * 45; s += ORN_LEAF(cx, cy, r, a, r * 0.36); }
  return s + `<circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="${cx}" cy="${cy}" r="${r * 0.2}"/>`;
}
ORN_DIV.rinceau = {name:"תלתלי גפן", half: ornRinceau(), mid: ornRosette(200, 24, 9)};
ORN_DIV.rinceauLine = {name:"פרח ותלתלים בקו", half: ornRinceau({n: 2, gap: 32, tail: 398, R: 7}), mid: ornRosette(200, 24, 10)};
ORN_DIV.rinceauLong = {name:"תלתלים ארוכים", half: ornRinceau({n: 5, gap: 34, R: 6.4, A: 6}), mid: `<path d="M200 6C203 13 207 16 207 21C207 26 203 28 200 33C197 28 193 26 193 21C193 16 197 13 200 6Z"/><circle cx="200" cy="39" r="2.2"/>`};
ORN_IDS.splice(0, ORN_IDS.length, ...Object.keys(ORN_DIV));
// v1.8.98 (Eli's sample 11-03, the calligraphic flourish): a PEN — a stroke whose width swells and thins along its path,
// drawn as a filled shape. The path = a list of points (a bezier or a spiral, sampled); w(t) = the width at 0..1.
function ornPen(pts, wfn){
  const n = pts.length, L = [], R = [];
  for(let i = 0; i < n; i++){
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const w = Math.max(0.25, wfn(i / (n - 1))) / 2;
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]); R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  const f = (p) => p[0].toFixed(2) + " " + p[1].toFixed(2);
  return `<path d="M${L.map(f).join("L")}L${R.reverse().map(f).join("L")}Z"/>`;
}
function ornBez(p0, p1, p2, p3, n){
  const o = []; n = n || 40;
  for(let i = 0; i <= n; i++){ const t = i / n, u = 1 - t;
    o.push([u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0], u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]]); }
  return o;
}
function ornSpiralPts(cx, cy, r, turns, dir, phase, n){
  const o = []; n = n || Math.round(turns * 30);
  for(let i = 0; i <= n; i++){ const f = i / n, a = phase + dir * f * turns * Math.PI * 2, rr = r * (1 - f * 0.8); o.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  return o;
}
// the swell: thin at both ends, full in the middle (p = how fast it swells)
const ornSwell = (wmax, wmin, p) => (t) => (wmin || 0.6) + (wmax - (wmin || 0.6)) * Math.pow(Math.sin(Math.PI * t), p || 1);
// the flourish, right half (centre x=200, y=50 in a 400×100 box): a main swash from the centre curl up over the crest and
// down into the big outer spiral; a second thinner swash below it; the small inner curl at the centre
function ornFlourishHalf(o){
  o = Object.assign({w: 5.2, thin: 0.5}, o || {});
  // 1. inner curl at the centre (a full round curl, as in the sample), its mouth = where the main swash begins
  const inner = ornSpiralPts(214, 56, 14, 1.0, 1, -Math.PI * 0.32).reverse();
  const m0 = inner[inner.length - 1];
  // 2. main swash: up over the crest, down, into the big outer spiral (curling up and in)
  const main = ornBez(m0, [240, 20], [292, 16], [328, 42], 36).concat(ornBez([328, 42], [350, 58], [370, 64], [386, 55], 22).slice(1))
    .concat(ornSpiralPts(378, 42, 15, 0.9, -1, Math.PI * 0.42).slice(1));
  // 3. the lower swash hugs the main one: leaves the curl's belly, runs under the crest and out along the outer spiral
  const low = ornBez([224, 66], [256, 66], [300, 60], [340, 60], 40).concat(ornBez([340, 60], [356, 60], [372, 56], [388, 52], 16).slice(1));
  // 4. a little spiral growing off the crest, above the line
  const top = ornBez([270, 24], [278, 12], [294, 6], [304, 14], 18).concat(ornSpiralPts(298, 19, 8, 0.85, 1, -Math.PI * 0.35).slice(1));
  return ornPen(inner, (t) => o.thin + (o.w * 0.85 - o.thin) * Math.pow(t, 1.2))
    + ornPen(main, (t) => o.thin + (o.w - o.thin) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.3)), 0.85))
    + ornPen(low, ornSwell(o.w * 0.5, o.thin, 1.2))
    + ornPen(top, (t) => o.w * 0.55 * (1 - t) + o.thin);
}
// a spear / fleur finial (the sample's centre piece): a pointed leaf with a notch, drawn as filled shapes
function ornSpear(cx, y0, len, w, dir){
  const s = dir; // -1 = pointing up, 1 = pointing down
  return `<path d="M${cx} ${y0 + s * len}C${cx + w * 0.55} ${y0 + s * len * 0.55} ${cx + w} ${y0 + s * len * 0.35} ${cx + w * 0.3} ${y0 + s * len * 0.15}C${cx + w * 0.15} ${y0 + s * len * 0.3} ${cx + w * 0.1} ${y0 + s * len * 0.5} ${cx} ${y0 + s * len * 0.62}C${cx - w * 0.1} ${y0 + s * len * 0.5} ${cx - w * 0.15} ${y0 + s * len * 0.3} ${cx - w * 0.3} ${y0 + s * len * 0.15}C${cx - w} ${y0 + s * len * 0.35} ${cx - w * 0.55} ${y0 + s * len * 0.55} ${cx} ${y0 + s * len}Z"/>`
    + `<path d="M${cx} ${y0 + s * len * 0.3}C${cx + w * 0.22} ${y0 + s * len * 0.42} ${cx + w * 0.22} ${y0 + s * len * 0.7} ${cx} ${y0 + s * len * 0.92}C${cx - w * 0.22} ${y0 + s * len * 0.7} ${cx - w * 0.22} ${y0 + s * len * 0.42} ${cx} ${y0 + s * len * 0.3}Z" fill="#fff"/>`
    + `<path d="M${cx} ${y0 + s * len * 0.5}C${cx + w * 0.1} ${y0 + s * len * 0.6} ${cx + w * 0.1} ${y0 + s * len * 0.75} ${cx} ${y0 + s * len * 0.86}C${cx - w * 0.1} ${y0 + s * len * 0.75} ${cx - w * 0.1} ${y0 + s * len * 0.6} ${cx} ${y0 + s * len * 0.5}Z"/>`;
}
// acanthus: C-scrolls (two per side, thick-thin) around the spear, a long tapering swash out to each side
function ornAcanthusHalf(o){
  o = Object.assign({w: 5.5, thin: 0.5}, o || {});
  const swl = (wmax, p) => (t) => o.thin + (wmax - o.thin) * Math.pow(Math.sin(Math.PI * Math.min(1, t)), p || 0.9);
  let s = "";
  // the C-scroll hugging the spear, above and below: a round arc from the centre line, ending in a tight curl towards the spear
  s += ornPen(ornBez([208, 50], [212, 30], [236, 24], [246, 36], 30).concat(ornSpiralPts(240, 40, 7, 0.8, 1, -Math.PI * 0.5).slice(1)), swl(o.w, 0.7));
  s += ornPen(ornBez([208, 50], [212, 70], [236, 76], [246, 64], 30).concat(ornSpiralPts(240, 60, 7, 0.8, -1, Math.PI * 0.5).slice(1)), swl(o.w, 0.7));
  // a leaf tip curling out of each scroll
  s += ORN_LEAF(236, 26, 16, -20, 4.2) + ORN_LEAF(236, 74, 16, 20, 4.2);
  // the second, back-to-back pair of C-scrolls
  s += ornPen(ornSpiralPts(270, 41, 13, 0.95, 1, Math.PI * 0.95), swl(o.w * 0.85, 0.8));
  s += ornPen(ornSpiralPts(270, 59, 13, 0.95, -1, -Math.PI * 0.95), swl(o.w * 0.85, 0.8));
  // the long swash out to a fine point, a thinner one under it, and the curl at its root
  s += ornPen(ornBez([256, 50], [296, 30], [340, 36], [398, 44], 50), (t) => o.thin + (o.w - o.thin) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02 + 0.1)), 1.3));
  s += ornPen(ornBez([256, 50], [296, 68], [330, 64], [368, 56], 40).concat(ornSpiralPts(374, 48, 8.5, 0.9, -1, Math.PI * 0.5).slice(1)), swl(o.w * 0.7, 1.1));
  return s;
}
ORN_DIV.flourish = {name:"סלסול קליגרפי", vb: 100, half: ornFlourishHalf(), mid: ""};
ORN_DIV.flourishLight = {name:"סלסול עדין", vb: 100, half: ornFlourishHalf({w: 3.2, thin: 0.4}), mid: ""};
ORN_DIV.acanthus = {name:"אקנתוס עם חוד", vb: 100, half: ornAcanthusHalf(), mid: ornSpear(200, 50, 38, 11, -1) + ornSpear(200, 50, 38, 11, 1) + `<circle cx="200" cy="50" r="3.2"/>`};
ORN_IDS.splice(0, ORN_IDS.length, ...Object.keys(ORN_DIV));
// the drawer: every drawn ornament, big; a click puts it after the line where the cursor is (or the paragraph clicked)
// v1.8.98 (Eli: "בצבע אפור, שקוע או בולט"): how an ornament is printed — its tone and its relief
const ORN_TONES = [["", "שחור"], ["gray", "אפור"], ["light", "אפור בהיר"]];
const ORN_RELIEFS = [["", "שטוח"], ["raised", "בולט"], ["sunken", "שקוע"], ["shadow", "עם צל"]];
const ORN_WORDS = {gray:"אפור", light:"בהיר", raised:"בולט", sunken:"שקוע", shadow:"צל"};
function ornLookOf(words){   // "אפור שקוע רוחב=40 צד=ימין" -> {tone, relief, w, h, align, b, a}
  const w = String(words || ""), L = {tone:"", relief:""};
  if(/בהיר/.test(w)) L.tone = "light"; else if(/אפור/.test(w)) L.tone = "gray"; else if(/שחור/.test(w)) L.tone = "black";
  if(/בולט/.test(w)) L.relief = "raised"; else if(/שקוע/.test(w)) L.relief = "sunken"; else if(/צל/.test(w)) L.relief = "shadow"; else if(/שטוח/.test(w)) L.relief = "flat";
  const num = (k) => { const m = w.match(new RegExp(k + "=(-?[\\d.]+)")); return m ? +m[1] : null; };
  L.w = num("רוחב"); L.h = num("גובה"); L.b = num("לפני"); L.a = num("אחרי");
  const s = w.match(/צד=(ימין|שמאל|מרכז)/); L.align = s ? {"ימין":"r", "שמאל":"l", "מרכז":"c"}[s[1]] : "";
  return L;
}
// "black" / "flat" = chosen on purpose (they print as nothing special, but they do not take the book's grey)
function ornLookCls(L){ return (L && L.tone && L.tone !== "black" ? " bk-orn-" + L.tone : "") + (L && L.relief && L.relief !== "flat" ? " bk-orn-" + L.relief : ""); }
function ornLookWords(L){
  if(!L) return "";
  return [L.tone ? (ORN_WORDS[L.tone] || {black:"שחור"}[L.tone]) : "", L.relief ? (ORN_WORDS[L.relief] || {flat:"שטוח"}[L.relief]) : "",
    L.w != null ? "רוחב=" + L.w : "", L.h != null ? "גובה=" + L.h : "", L.align ? "צד=" + {r:"ימין", l:"שמאל", c:"מרכז"}[L.align] : "",
    L.b != null ? "לפני=" + L.b : "", L.a != null ? "אחרי=" + L.a : ""].filter(Boolean).join(" ");
}
// what an ornament really looks like: its own settings, else the book's (one place: «כך בכל העיטורים בספר»)
function ornEff(L){
  L = L || {}; const B = st.ornLook || {};
  return {tone: L.tone || B.tone || "", relief: L.relief || B.relief || "",
    w: L.w != null ? L.w : (+st.ornWidth || 62), h: L.h != null ? L.h : (+st.ornH || 0),
    align: L.align || st.ornAlign || "c", b: L.b != null ? L.b : (st.ornBefore != null ? +st.ornBefore : 0.5), a: L.a != null ? L.a : (st.ornAfter != null ? +st.ornAfter : 0.6)};
}
let ORN_PICK = {tone:"", relief:""};   // what the drawer is set to (kept while the studio is open)
// v1.9.00 (Eli 11-03: "צריך חלון חיפוש למצוא פונקציה"): one box that finds any button, topic or setting by its name
const FN_PANELS = [["all", "bkPanelDesign"], ["styles", "bkPanelStyles"], ["details", "bkPanelDetails"]];
const FN_SEL = "label,legend,summary,h3,h4,b,.bk-pill";
function fnText(el){ const t = (el.firstChild && el.firstChild.nodeType === 3 && el.firstChild.textContent.trim() ? el.firstChild.textContent : el.textContent) || ""; return t.replace(/\s+/g, " ").trim(); }
function fnTopic(k){ const b = ROOT.querySelector('.bk-rail [data-topic="' + k + '"]'); if(b && b.getAttribute("aria-selected") !== "true") b.click(); else if(b && !railOpen) b.click(); }
function fnIndex(){
  const out = [], seen = new Set();
  const add = o => { const key = o.kind + "|" + o.name; if(!o.name || seen.has(key)) return; seen.add(key); out.push(o); };
  RAIL_TOPICS.forEach(([k, ic, l]) => add({kind:"topic", ic, name:l, tip:RAIL_SUB[k] || "", where:"נושא בסרגל הצד", go:() => { const b = ROOT.querySelector('.bk-rail [data-topic="' + k + '"]'); if(b) b.click(); }}));
  RIB.forEach(g => (g.btns || []).forEach(([k, , l, tip]) => add({kind:"btn", ic:"▪", name:l, tip:tip || "", where:"סרגל " + g.name, go:() => ribAct(k)})));
  const R = {bkPanelDesign:renderDesign, bkPanelStyles:renderStyles, bkPanelDetails:renderDetails};
  FN_PANELS.forEach(([topic, pid]) => {
    const P = $(pid); if(!P) return;
    if(!P.children.length){ try{ R[pid](); }catch(e){} }
    const tn = (RAIL_TOPICS.find(x => x[0] === topic) || [])[2] || "";
    P.querySelectorAll(FN_SEL).forEach(el => {
      const t = fnText(el); if(t.length < 2 || t.length > 70) return;
      add({kind:"set", ic:"⚙", name:t, tip:"", where:"הגדרה · " + tn, go:() => {
        fnTopic(topic);
        setTimeout(() => {
          const P2 = $(pid), hit = P2 && [...P2.querySelectorAll(FN_SEL)].find(x => fnText(x) === t);
          if(!hit) return;
          for(let d = hit.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true;
          if(hit.offsetParent === null){ const all = ROOT.querySelector('.bk-rail [data-topic="all"]'); if(all) all.click(); }
          hit.scrollIntoView({block:"center", behavior:"smooth"});
          hit.classList.add("bk-fnflash"); setTimeout(() => hit.classList.remove("bk-fnflash"), 2400);
        }, 90);
      }});
    });
  });
  return out;
}
window.__bkFnFind = () => fnFind();
function fnFind(){
  const IDX = fnIndex();
  const D = modal(`<header><h3>🔎 חיפוש פונקציה</h3><button type="button" class="bk-btn bk-x" id="bkFnX" title="סגור" aria-label="סגור">✕</button></header>
    <div class="bk-dbody"><input class="bk-input bk-fnq" id="bkFnQ" placeholder="מה מחפשים? למשל: שוליים, עיטור, הערה, גופן…" autocomplete="off"/>
    <div class="bk-fnlist" id="bkFnList" role="listbox"></div></div>`, "bk-fndlg");
  const Q = D.querySelector("#bkFnQ"), L = D.querySelector("#bkFnList");
  let hits = [], cur = 0;
  const norm = x => (x || "").replace(/[֑-ׇ"'״׳]/g, "").toLowerCase();
  const draw = () => {
    const words = norm(Q.value.trim()).split(/\s+/).filter(Boolean);
    hits = !words.length ? IDX.filter(o => o.kind === "topic")
      : IDX.map(o => { const n = norm(o.name), all = n + " " + norm(o.tip + " " + o.where);
          return words.every(w => all.includes(w)) ? [o, n.startsWith(words[0]) ? 0 : n.includes(words[0]) ? 1 : 2] : null; })
        .filter(Boolean).sort((a, b) => a[1] - b[1]).map(x => x[0]).slice(0, 40);
    cur = 0;
    L.innerHTML = hits.length ? hits.map((o, i) => `<button type="button" class="bk-fnhit${i === cur ? " on" : ""}" data-i="${i}" role="option"><i>${o.ic}</i><span><b>${esc(o.name)}</b><small>${esc(o.where)}${o.tip ? " — " + esc(o.tip) : ""}</small></span></button>`).join("")
      : `<p class="bk-dhint">לא נמצא. נסו מילה אחרת.</p>`;
  };
  const pick = i => { const o = hits[i]; if(!o) return; closeModal(); setTimeout(o.go, 30); };
  Q.addEventListener("input", draw);
  Q.addEventListener("keydown", e => {
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault(); if(!hits.length) return;
      cur = (cur + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      L.querySelectorAll(".bk-fnhit").forEach((b, i) => b.classList.toggle("on", i === cur)); L.children[cur].scrollIntoView({block:"nearest"});
    }
    if(e.key === "Enter"){ e.preventDefault(); pick(cur); }
  });
  L.addEventListener("click", e => { const b = e.target.closest(".bk-fnhit"); if(b) pick(+b.dataset.i); });
  D.querySelector("#bkFnX").addEventListener("click", closeModal);
  draw(); setTimeout(() => Q.focus(), 40);
}
// for the automatic checks only: the live book (text + design), without timestamps
window.__bkState = () => book ? JSON.stringify({sections: book.sections, style: Object.assign({}, st, {meta: undefined})}) : "";
function ornDrawer(){
  if(!ORN_PARTS){ const D0 = modal(`<header><h3>🌿 עיטורים להפרדה</h3><button type="button" class="bk-btn bk-x" id="bkOrnX" title="סגור" aria-label="סגור">✕</button></header><div class="bk-dbody"><p class="bk-dhint">טוען את העיטורים…</p></div>`, "bk-orndlg"); ornLoad().then(() => { if($("bkDialog").contains(D0.firstElementChild) || true) ornDrawer(); }); return; }
  const D = modal(`<header><h3>🌿 עיטורים להפרדה</h3><button type="button" class="bk-btn bk-x" id="bkOrnX" title="סגור" aria-label="סגור">✕</button></header><div class="bk-dbody"><p class="bk-dhint">לוחצים על עיטור — והוא נכנס אחרי השורה שבה עומד הסמן בטקסט (או אחרי הפסקה שלחצתם עליה בדף).</p>
    <div class="bk-ornlookbar"><span>צבע:</span>${ORN_TONES.map(([v, n]) => `<button type="button" class="bk-pill${ORN_PICK.tone === v ? " on" : ""}" data-orntone="${v}">${n}</button>`).join("")}
      <span>מראה:</span>${ORN_RELIEFS.map(([v, n]) => `<button type="button" class="bk-pill${ORN_PICK.relief === v ? " on" : ""}" data-ornrelief="${v}">${n}</button>`).join("")}</div>
    <div class="bk-ornsize"><label>גודל העיטור בספר <input type="range" id="bkOrnW" min="15" max="100" step="1" value="${+st.ornWidth || 62}"/> <output id="bkOrnWv">${+st.ornWidth || 62}%</output></label>
      <label>גובה (מתיחה) <input type="range" id="bkOrnH" min="0" max="4" step="0.1" value="${+st.ornH || 0}"/> <output id="bkOrnHv">${+st.ornH ? st.ornH + "" : "טבעי"}</output></label>
      <button type="button" class="bk-pill" id="bkOrnReset">↺ גודל רגיל</button></div>
    <div class="bk-orngrid${ornLookCls(ORN_PICK)}">${ORN_IDS.map(id => `<button type="button" class="bk-ornpick" data-orn="${id}" title="להוסיף את «${esc(ORN_DIV[id].name)}» אחרי הפסקה שבחרתם">${ornSvg(id, 2.2)}<span>${esc(ORN_DIV[id].name)}</span></button>`).join("")}</div>
    <div class="bk-ornhead${ornLookCls(ORN_PICK)}"><b>לכותרות:</b>
      <button type="button" class="bk-ornpick bk-ornlook${st.chapterLook === "cartouche" ? " on" : ""}" data-ornlook="chapterLook:cartouche">${ornCartouche("<span class=\"bk-cartdemo\">" + esc(st.chapterWord || "פרשת") + " …</span>")}<span>כותרת ה${esc(st.chapterWord || "פרק")} במסגרת מעוטרת</span></button>
      <button type="button" class="bk-ornpick bk-ornlook${st.simanLook === "curls" ? " on" : ""}" data-ornlook="simanLook:curls"><span class="bk-curldemo">${ornCurlSide(false)}א${ornCurlSide(true)}</span><span>מספר ה${esc(st.simanWord || "סימן")} בין תלתלים</span></button>
    </div>
    <label class="bk-ornall"><input type="checkbox" id="bkOrnAll"> לשים את העיטור שאבחר <b>בין כל הסימנים בספר</b> (במקום להוסיף אותו כאן)</label>
    </div><footer><button type="button" class="bk-btn" id="bkCancel">סגור</button></footer>`, "bk-orndlg");
  D.querySelector("#bkCancel").addEventListener("click", closeModal);
  D.querySelector("#bkOrnX").addEventListener("click", closeModal);
  // v1.9.00 (Eli: "לשחק עם העיטורים להקטין להגדיל להרחיב"): live size and stretch for every ornament in the book
  const oW = D.querySelector("#bkOrnW"), oH = D.querySelector("#bkOrnH");
  const oSet = () => { st.ornWidth = +oW.value; st.ornH = +oH.value; D.querySelector("#bkOrnWv").textContent = oW.value + "%"; D.querySelector("#bkOrnHv").textContent = +oH.value ? oH.value : "טבעי"; markDirty(); scheduleLayout(150); };
  oW.addEventListener("input", oSet); oH.addEventListener("input", oSet);
  D.querySelector("#bkOrnReset").addEventListener("click", () => { oW.value = 62; oH.value = 0; oSet(); });
  D.querySelectorAll("[data-orntone],[data-ornrelief]").forEach(b => b.addEventListener("click", () => {
    if(b.dataset.orntone != null) ORN_PICK.tone = b.dataset.orntone; else ORN_PICK.relief = b.dataset.ornrelief;
    // the book's own ornaments (between the parts, the heading frames) take the look at once
    if(/^d:/.test(st.sectionSep || "") || st.chapterLook === "cartouche" || st.simanLook === "curls"){ st.ornLook = Object.assign({}, ORN_PICK); markDirty(); scheduleLayout(0); }
    const y = D.querySelector(".bk-dbody").scrollTop; ornDrawer(); $("bkDialog").querySelector(".bk-dbody").scrollTop = y;
  }));
  D.querySelectorAll("[data-ornlook]").forEach(b => b.addEventListener("click", () => {
    const [k, v] = b.dataset.ornlook.split(":"); const on = st[k] === v;
    st[k] = on ? "plain" : v; if(!on) st.ornLook = Object.assign({}, ORN_PICK); markDirty(); scheduleLayout(0); closeModal();
    toast(on ? "הכותרת חזרה לרגילה" : "הכותרות בעיצוב החדש — אפשר להחזיר עם ↶", "ok");
  }));
  D.querySelectorAll("[data-orn]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.orn, all = D.querySelector("#bkOrnAll").checked;
    closeModal();
    if(all){ st.sectionSep = "d:" + id; st.ornLook = Object.assign({}, ORN_PICK); markDirty(); scheduleLayout(0); toast("העיטור «" + ORN_DIV[id].name + "» בין כל הסימנים", "ok"); return; }
    const ta = ribTextarea(); if(!ta){ ribNeedText(); return; }
    // after the END of the paragraph the cursor stands in — a paragraph may be several typed lines joined (paraLines)
    const v = ta.value, p = ta.selectionStart || 0, lineNo = v.slice(0, p).split("\n").length - 1;
    const starts = paraLines(v, st).filter(x => String(x[0]).trim()).map(x => x[1]);
    const next = starts.find(l => l > lineNo);
    const L0 = v.split("\n"); let at;
    if(next == null) at = v.length;
    else { let j = next - 1; while(j > lineNo && !L0[j].trim()) j--; at = L0.slice(0, j + 1).join("\n").length; }
    const B = st.ornLook || {}, P = {tone: ORN_PICK.tone !== (B.tone || "") ? (ORN_PICK.tone || "black") : "", relief: ORN_PICK.relief !== (B.relief || "") ? (ORN_PICK.relief || "flat") : ""};
    const words = ornLookWords(P);
    ta.focus(); ta.setSelectionRange(at, at); insertText(ta, "\n@@עיטור " + id + (words ? " " + words : "") + "\n");
    toast("נוסף עיטור «" + ORN_DIV[id].name + "»", "ok");
  }));
}

// ---- v1.9.01: the ornament's own editor, on the page (Eli: "לערוך ולעצב את העיטור בעמוד עצמו … ושיהיה ניתן להגדיר
// שכך יהיה בכל מקום בספר"). A typed ornament = its line "@@עיטור id …" in the text; the one between all simanim
// (ln -1) = the book's settings. Every change shows at once; «כך בכל העיטורים בספר» makes these the book's settings.
function ornLineAt(sec, ln){ const L = String(sec.text || "").split("\n"); return {lines: L, m: (L[ln] || "").trim().match(/^@@עיטור[:\s]+(\S+)(.*)$/)}; }
function ornEditPop(e, el){
  const pv = $("bkPreview"), r = pv.getBoundingClientRect(), z = parseFloat(pv.style.zoom) || 1;
  const secId = el.dataset.sec, ln = parseInt(el.dataset.ln || "-1", 10), sec = book.sections.find(x => x.id === secId);
  const whole = !(ln >= 0 && sec);   // the separator between all simanim
  let id = el.dataset.orn, own = {};
  if(!whole){ const X = ornLineAt(sec, ln); if(!X.m){ toast("לא מצאתי את שורת העיטור בטקסט", "warn"); return; } id = X.m[1]; own = ornLookOf(X.m[2]); }
  hidePop();
  const pop = h("div", {class:"bk-pop bk-ornpop", id:"bkPop", role:"dialog"});
  // just under the ornament (not over it — Abba sees it change while he slides)
  const er = el.getBoundingClientRect();
  pop.style.top = Math.max(4, (er.bottom - r.top) / z + pv.scrollTop / z + 8) + "px";
  pop.style.left = Math.max(4, Math.min(r.width / z - 350, ((er.left + er.right) / 2 - r.left) / z - 170)) + "px";
  const save = (o) => {
    if(whole){
      // the separator between all simanim IS the book's setting
      st.sectionSep = "d:" + id; st.ornWidth = o.w; st.ornH = o.h; st.ornAlign = o.align; st.ornBefore = o.b; st.ornAfter = o.a;
      st.ornLook = {tone: o.tone === "black" ? "" : o.tone, relief: o.relief === "flat" ? "" : o.relief};
    } else {
      const X = ornLineAt(sec, ln); if(!X.m) return;
      const words = ornLookWords(o);
      X.lines[ln] = "@@עיטור " + id + (words ? " " + words : "");
      sec.text = X.lines.join("\n"); syncOpenText(sec);
    }
    markDirty(); scheduleLayout(120);
  };
  const draw = () => {
    const E = ornEff(whole ? {} : own);
    const pill = (attr, v, n, on) => `<button type="button" class="bk-pill${on ? " on" : ""}" data-${attr}="${v}">${n}</button>`;
    pop.innerHTML = `<button type="button" class="bk-popx" data-oe="x" title="סגור" aria-label="סגור">✕</button>
      <div class="bk-pophint">🌿 ${whole ? "העיטור שבין כל הסימנים" : "העיטור הזה"} — «${esc((ORN_DIV[id] || {}).name || id)}»</div>
      <div class="bk-oe-row"><span>גודל</span><input type="range" min="8" max="100" step="1" value="${E.w}" data-oe="w"/><output>${E.w}%</output></div>
      <div class="bk-oe-row"><span>מתיחה</span><input type="range" min="0" max="5" step="0.1" value="${E.h}" data-oe="h"/><output>${E.h ? E.h : "טבעי"}</output></div>
      <div class="bk-oe-row"><span>רווח מעל</span><input type="range" min="0" max="4" step="0.1" value="${E.b}" data-oe="b"/><output>${E.b}</output></div>
      <div class="bk-oe-row"><span>רווח מתחת</span><input type="range" min="0" max="4" step="0.1" value="${E.a}" data-oe="a"/><output>${E.a}</output></div>
      <div class="bk-oe-row"><span>מיקום</span>${pill("oealign", "r", "⇥ ימין", E.align === "r")}${pill("oealign", "c", "≡ באמצע", E.align === "c")}${pill("oealign", "l", "⇤ שמאל", E.align === "l")}</div>
      <div class="bk-oe-row"><span>צבע</span>${ORN_TONES.map(([v, n]) => pill("oetone", v || "black", n, (E.tone || "black") === (v || "black"))).join("")}</div>
      <div class="bk-oe-row"><span>מראה</span>${ORN_RELIEFS.map(([v, n]) => pill("oerelief", v || "flat", n, (E.relief || "flat") === (v || "flat"))).join("")}</div>
      <details class="bk-oe-pick"><summary>🔁 להחליף לעיטור אחר</summary><div class="bk-oe-grid">${ORN_IDS.map(k => `<button type="button" class="bk-ornpick${k === id ? " on" : ""}" data-oeid="${k}" title="${esc(ORN_DIV[k].name)}">${ornSvg(k, 1.4)}</button>`).join("")}</div></details>
      ${whole ? "" : `<div class="bk-oe-row">${pill("oe", "up", "⬆ להזיז למעלה", false)}${pill("oe", "down", "⬇ להזיז למטה", false)}${pill("oe", "del", "🗑 למחוק", false)}</div>`}
      <button type="button" class="bk-oe-all" data-oe="all">📚 כך בכל העיטורים בספר <small>(גם אלה שכבר יש, וגם אלה שיתווספו)</small></button>
      ${whole ? "" : `<button type="button" class="bk-oe-same" data-oe="same">🔁 העיטור הזה בכל המקומות בספר</button>`}`;
  };
  const cur = () => ornEff(whole ? {} : own);
  pop.addEventListener("input", ev => {
    const s = ev.target.closest("input[data-oe]"); if(!s) return;
    const k = s.dataset.oe, v = +s.value;
    if(whole){ const E = cur(); E[k] = v; save(E); } else { own[k] = v; save(own); }
    const o = s.parentElement.querySelector("output"); if(o) o.textContent = k === "w" ? v + "%" : (k === "h" && !v ? "טבעי" : v);
  });
  pop.addEventListener("click", ev => {
    const b = ev.target.closest("button"); if(!b) return;
    const set = (k, v) => { if(whole){ const E = cur(); E[k] = v; save(E); } else { own[k] = v; save(own); } draw(); };
    if(b.dataset.oe === "x"){ hidePop(); return; }
    if(b.dataset.oealign){ set("align", b.dataset.oealign); return; }
    if(b.dataset.oetone){ set("tone", b.dataset.oetone); return; }
    if(b.dataset.oerelief){ set("relief", b.dataset.oerelief); return; }
    if(b.dataset.oeid){ id = b.dataset.oeid; if(whole){ save(cur()); } else save(own); draw(); return; }
    const a = b.dataset.oe;
    if(a === "up" || a === "down" || a === "del"){
      const X = ornLineAt(sec, ln); if(!X.m) return;
      if(a === "del"){ X.lines.splice(ln, 1); sec.text = X.lines.join("\n"); syncOpenText(sec); markDirty(); scheduleLayout(0); hidePop(); toast("העיטור נמחק — אפשר להחזיר עם ↶", "ok"); return; }
      // past the neighbouring paragraph (empty lines skipped); at the edge of the part it moves into the next / previous part
      const step = a === "up" ? -1 : 1; let j = ln + step;
      while(j >= 0 && j < X.lines.length && !X.lines[j].trim()) j += step;
      if(j < 0 || j >= X.lines.length){
        const i = book.sections.indexOf(sec), other = book.sections[i + step];
        if(!other){ toast(a === "up" ? "זה כבר בתחילת הספר" : "זה כבר בסוף הספר", "warn"); return; }
        const line = X.lines.splice(ln, 1)[0]; sec.text = X.lines.join("\n");
        const O = String(other.text || "").split("\n");
        if(a === "up") O.push(line); else O.unshift(line);
        other.text = O.join("\n"); syncOpenText(sec); syncOpenText(other);
        markDirty(); scheduleLayout(0); hidePop(); toast("העיטור עבר " + (a === "up" ? "לסוף הקטע הקודם" : "לתחילת הקטע הבא"), "ok"); return;
      }
      const line = X.lines.splice(ln, 1)[0]; X.lines.splice(j, 0, line);
      sec.text = X.lines.join("\n"); syncOpenText(sec); markDirty(); scheduleLayout(0); hidePop();
      toast("העיטור זז " + (a === "up" ? "למעלה" : "למטה") + " — לחיצה עליו שוב מזיזה עוד", "ok"); return;
    }
    if(a === "all"){
      // these settings become the book's, and every typed ornament drops its own (so all follow, and new ones too)
      const E = cur();
      st.ornWidth = E.w; st.ornH = E.h; st.ornAlign = E.align; st.ornBefore = E.b; st.ornAfter = E.a;
      st.ornLook = {tone: E.tone === "black" ? "" : E.tone, relief: E.relief === "flat" ? "" : E.relief};
      ORN_PICK = Object.assign({}, st.ornLook);
      let n = 0;
      for(const s of book.sections){
        const L = String(s.text || "").split("\n"); let ch = false;
        L.forEach((x, i) => { const m = x.trim().match(/^@@עיטור[:\s]+(\S+)(.*)$/); if(m && m[2].trim()){ L[i] = "@@עיטור " + m[1]; ch = true; } if(m) n++; });
        if(ch){ s.text = L.join("\n"); syncOpenText(s); }
      }
      markDirty(); scheduleLayout(0); hidePop();
      toast("✓ כל העיטורים בספר (" + n + (/^d:/.test(st.sectionSep || "") ? " + המפריד בין הסימנים" : "") + ") ייראו כך, וגם כל עיטור שיתווסף", "ok"); return;
    }
    if(a === "same"){
      let n = 0;
      for(const s of book.sections){
        const L = String(s.text || "").split("\n"); let ch = false;
        L.forEach((x, i) => { const m = x.trim().match(/^@@עיטור[:\s]+(\S+)(.*)$/); if(m && m[1] !== id){ L[i] = "@@עיטור " + id + m[2]; ch = true; n++; } });
        if(ch){ s.text = L.join("\n"); syncOpenText(s); }
      }
      if(/^d:/.test(st.sectionSep || "")) st.sectionSep = "d:" + id;
      markDirty(); scheduleLayout(0); hidePop(); toast("✓ «" + ((ORN_DIV[id] || {}).name || id) + "» בכל המקומות (" + n + " הוחלפו)", "ok"); return;
    }
  });
  draw();
  pv.appendChild(pop);
  // the swap list opening makes the editor taller: it is placed again so all of it stays on the screen
  pop.addEventListener("toggle", () => place(), true);
  const place = () => {
  pop.style.top = Math.max(4, (er.bottom - r.top) / z + pv.scrollTop / z + 8) + "px";
  pop.style.left = Math.max(4, Math.min(r.width / z - 350, ((er.left + er.right) / 2 - r.left) / z - 170)) + "px";
  // inside the visible part of the pages, and never over the ornament: below it, else above it, else beside it
  const vis = pv.getBoundingClientRect(), top0 = Math.max(0, vis.top) + 6, bot0 = Math.min(window.innerHeight, vis.bottom) - 6;
  pop.style.maxHeight = Math.max(260, (bot0 - top0) / z) + "px"; pop.style.overflowY = "auto";
  const ph = pop.getBoundingClientRect().height, shift = (dy) => { pop.style.top = (parseFloat(pop.style.top) + dy / z) + "px"; };
  if(er.bottom + 8 + ph <= bot0){ /* below: already there */ }
  else if(er.top - 8 - ph >= top0){ shift((er.top - 8 - ph) - pop.getBoundingClientRect().top); }
  else {
    // beside: on the other half of the page, at the ornament's height
    const pr = pop.getBoundingClientRect(), room = (er.left + er.right) / 2 > (vis.left + vis.right) / 2 ? "left" : "right";
    const x = room === "left" ? Math.max(vis.left + 6, er.left - pr.width - 12) : Math.min(vis.right - pr.width - 6, er.right + 12);
    pop.style.left = (parseFloat(pop.style.left) + (x - pr.left) / z) + "px";
    shift(Math.min(bot0 - ph, Math.max(top0, er.top - ph / 3)) - pr.top);
  }
  };
  place();
}
})();
