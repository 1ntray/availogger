import { ActionButton } from '../../app/controls';

export type ExchangeOpportunity = { id: string; label: string; person: string; onOffer: () => void };

export function ExchangeStart({ assignment, opportunities, busy, onPost, onGiveAway }: {
  assignment: string; opportunities: ExchangeOpportunity[]; busy: boolean; onPost: () => void;
  onGiveAway?: () => void;
}) {
  return <div className="exchange-start">
    <p className="exchange-start-assignment"><strong>Your assignment</strong><br />{assignment}</p>
    <h4>Available exchanges</h4>
    {opportunities.length ? <ul className="exchange-opportunities">{opportunities.map(item => <li key={item.id}>
      <span><strong>{item.label}</strong><small>{item.person} wants to swap</small></span>
      <ActionButton disabled={busy} onClick={item.onOffer}>Offer your assignment</ActionButton>
    </li>)}</ul> : <p className="exchange-note">No available exchanges</p>}
    <div className="exchange-start-post"><ActionButton disabled={busy} onClick={onPost}>Post my assignment for swap</ActionButton>
      {onGiveAway && <ActionButton disabled={busy} onClick={onGiveAway}>Give away</ActionButton>}</div>
  </div>;
}
