import { useLayoutEffect, useRef } from 'react';
import type { AttackOption, Counter } from '../../../../crates/game-wasm/pkg/game_wasm.js';
import { unitNames } from '../renderer/operation';

export function CombatOrder({ preview, defender, terrain, onAttack, onCancel }: {
  preview: AttackOption; defender: Counter; terrain: string; onAttack: () => void; onCancel: () => void;
}) {
  const card=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    card.current?.scrollIntoView({block:'nearest',inline:'nearest'});
  },[defender.id]);
  return <section ref={card} className="combat-order" aria-label="Предпросмотр боя">
    <div className="battle-info"><h2>Предпросмотр боя</h2>
    <p>Цель · {unitNames[defender.kind]} ({defender.position.q}, {defender.position.r}) · {terrain}</p>
    <table><caption>Возможные потери прочности</caption>
      <thead><tr><th>Сторона</th><th>Сила</th><th>Потери</th></tr></thead>
      <tbody><tr><th>Атакующий</th><td>{preview.attack}</td><td>{preview.attacker_min}–{preview.attacker_max}</td></tr>
        <tr><th>Защитник</th><td>{preview.defense}</td><td>{preview.defender_min}–{preview.defender_max}</td></tr></tbody>
    </table>
    <div className="battle-modifiers"><p>Снабжение · атака {preview.attack_factor}%, защита {preview.defense_factor}%</p>
    <p>Штаб · атакующий +{preview.attack_hq}, защитник +{preview.defense_hq}</p>
    <p>Защита · местность +{preview.terrain}, окопы +{preview.entrenchment}, река +{preview.river}</p></div></div>
    <div className="battle-actions"><button className="cancel-order" onClick={onCancel}>Отмена</button>
    <button className="primary" onClick={onAttack}>Атаковать</button></div>
  </section>;
}
