// 80個の価値観カード。
// プレースホルダー: 実際の weboxバリューズカード の内容は手動で差し替える。
// 並びは表示順ではない(ゲーム開始時にシャッフルされる)。
// インデックス 0..79 をカードIDとして扱う。

export const VALUES = Array.from({ length: 80 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return `価値観${n}`;
});
