const E=require('../src/engine.js'); const assert=require('assert');
// ordem
assert(E.beats('CA','C7','E')); assert(E.beats('C7','CK','E')); assert(E.beats('CJ','CQ','E'));
assert(E.beats('E2','CA','E')); assert(!E.beats('O A'.replace(' ',''),'C2','E'));
// vencedor
assert.equal(E.trickWinner([{player:0,card:'CQ'},{player:1,card:'CJ'},{player:2,card:'OA'}],'E'),1);
// pontuação da folha
const f=(a)=>a.reduce((x,y)=>x+y,0);
assert.equal(f([10,11,0,10,0,12]),43);
assert.equal(E.scoreFor(2,2),12); assert.equal(E.scoreFor(0,0),10); assert.equal(E.scoreFor(1,2),0);
// simulação
let games=0, rounds=0, hits=0, tot=0;
for(const N of [3,4,5]) for(const set of [{},{dealerRule:true},{upDown:true,mustTrump:true},{trumpRotation:true,dealerRule:true}]) for(let g=0;g<800;g++){
  const lv=['easy','normal','hard'];
  const st=E.newGame(Array.from({length:N},(_,i)=>({name:'B'+i,isBot:true,level:lv[i%3]})),set);
  while(true){
    E.startRound(st); rounds++;
    const n=E.cardsThisRound(st);
    while(st.phase==='bidding') E.placeBid(st,st.turn,E.aiBid(st,st.turn));
    if(set.dealerRule) assert(st.players.reduce((a,p)=>a+p.bid,0)!==n);
    while(st.phase!=='roundEnd'){
      if(st.phase==='playing') E.playCard(st,st.turn,E.aiPlay(st,st.turn));
      else E.resolveTrick(st);
    }
    assert.equal(st.players.reduce((a,p)=>a+p.tricks,0),n);
    st.players.forEach(p=>{tot++; if(p.bid===p.tricks)hits++;});
    if(E.isLastRound(st)) break;
  }
  games++;
}
console.log('ok', games, 'jogos', rounds,'rondas', 'acerto bots', (hits/tot*100).toFixed(1)+'%');
