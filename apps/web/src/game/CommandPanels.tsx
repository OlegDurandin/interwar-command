import type { GameFact, JournalEvent, MovementView } from '../../../../crates/game-wasm/pkg/game_wasm.js';
import { unitNames } from '../renderer/operation';

function describe(fact:GameFact,view:MovementView) {
  const side=(id:string)=>view.sides.find(s=>s.id===id)?.name ?? id;
  const unit=(id:string)=>{const u=view.units.find(u=>u.id===id);return u ? unitNames[u.kind] : id;};
  switch(fact.type) {
    case 'phase_started': return `Раунд ${fact.round} · ${side(fact.faction)} приняли командование`;
    case 'phase_ended': return `${side(fact.faction)} завершили фазу`;
    case 'round_ended': return `Раунд ${fact.round} завершён`;
    case 'unit_moved': {const end=fact.route.path.at(-1);return `${unit(fact.unit_id)} → (${end?.q}, ${end?.r})`;}
    case 'control_changed': return `${side(fact.faction)} заняли (${fact.at.q}, ${fact.at.r})`;
    case 'combat_resolved': return `Бой · потери ${fact.losses.attacker} / ${fact.losses.defender}`;
    case 'entrenched': return `${unit(fact.unit_id)} · окопы ${fact.level}`;
    case 'unit_advanced': return `${unit(fact.unit_id)} заняла клетку защитника`;
    case 'unit_destroyed': return `Часть ${unit(fact.unit_id)} уничтожена`;
    case 'objective_scored': return `${side(fact.faction)} · +${fact.points} за цель`;
    case 'game_finished': return `Итог · ${fact.result==='draw'?'ничья':side(fact.result.winner)+' победили'}`;
  }
}

export function Situation({view,events}:{view:MovementView;events:JournalEvent[]}) {
  return <aside className="situation">
    <details open><summary>Цели операции</summary>{view.cells.filter(c=>c.objective_points).map(c=>
      <div className="objective" key={c.position.q+','+c.position.r}><div><b>★</b> <strong>{c.city==='bridgehead'?'Предмостье':c.city || 'Контрольная точка'}</strong></div>
        <p>({c.position.q}, {c.position.r}) · {view.sides.find(s=>s.id===c.controller)?.name ?? 'Нейтральная'}</p>
        <small>+{c.objective_points} за раунд</small></div>)}
      <div className="score-line">{view.sides.map(s=><span key={s.id}>{s.name} <b>{s.score}</b></span>)}</div>
    </details>
    <details className="field-guide"><summary>Как играть</summary><ol>
      <li>Выберите свою часть. При любом масштабе коснитесь свободной золотой клетки, чтобы переместить часть. Она останется выбранной. Для просмотра пути сначала нажмите «Маршрут», затем клетку назначения.</li>
      <li>Занимайте отмеченные звёздой цели. Когда враг в пределах дальности, нажмите его фишку, сравните потери и подтвердите атаку.</li>
      <li>Завершите фазу. Очки за цель начисляются после ходов обеих сторон. В начале своей фазы часть получает снабжение и меняет готовность.</li>
    </ol></details>
    <details open><summary>Журнал операции</summary><ol className="dispatches">{events.slice(-6).reverse().map(e=>
      <li key={e.revision+'.'+e.order}>{describe(e.kind,view)}</li>)}</ol></details>
  </aside>;
}
