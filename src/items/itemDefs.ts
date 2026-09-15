/** 道具定义与名次加权抽取（纯函数，可测） */

export type ItemId = 'turbo' | 'rocket' | 'mine' | 'oil' | 'shield' | 'nitro';

export interface ItemDef {
  name: string;
  icon: string;
  desc: string;
  /** 强道具（偏落后者） */
  strong: boolean;
}

export const ITEM_DEFS: Record<ItemId, ItemDef> = {
  turbo: { name: '涡轮加速', icon: '⏩', desc: '3 秒强推力', strong: true },
  rocket: { name: '追踪弹', icon: '🚀', desc: '锁定前方最近车辆', strong: true },
  mine: { name: '地雷', icon: '💣', desc: '车尾布设，持续 20 秒', strong: true },
  nitro: { name: '氮气补给', icon: '⚡', desc: '氮气条回满', strong: false },
  shield: { name: '护盾', icon: '🛡', desc: '8 秒免疫一次负面效果', strong: false },
  oil: { name: '油渍', icon: '🛢', desc: '车尾放油，打滑 3 秒', strong: false },
};

export interface ItemWeights {
  rocket: number;
  turbo: number;
  mine: number;
  nitro: number;
  shield: number;
  oil: number;
}

/**
 * 马里奥赛车式名次加权：
 * 强道具份额 = 0.2 + 0.65·t（t = (名次-1)/(车数-1)，第 1 名 0.2，垫底 0.85）；
 * 强道具内 rocket 0.4 / turbo 0.35 / mine 0.25；弱道具内 nitro 0.4 / shield 0.35 / oil 0.25。
 */
export function itemWeights(position: number, total: number): ItemWeights {
  const t = total > 1 ? Math.min(1, Math.max(0, (position - 1) / (total - 1))) : 0;
  const strong = 0.2 + 0.65 * t;
  const weak = 1 - strong;
  return {
    rocket: strong * 0.4,
    turbo: strong * 0.35,
    mine: strong * 0.25,
    nitro: weak * 0.4,
    shield: weak * 0.35,
    oil: weak * 0.25,
  };
}

/** 按权重抽取（rng 可注入便于测试） */
export function rollItem(position: number, total: number, rng: () => number = Math.random): ItemId {
  const w = itemWeights(position, total);
  const r = rng();
  let acc = 0;
  for (const [id, weight] of Object.entries(w) as [ItemId, number][]) {
    acc += weight;
    if (r < acc) return id;
  }
  return 'oil';
}
