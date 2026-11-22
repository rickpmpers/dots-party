const $ = id => document.getElementById(id);
let socket, state, myId, roomCode, toastTimer, intentionalExit = false;
const savedName = localStorage.getItem('dots-name') || '';
$('hostName').value=savedName; $('joinName').value=savedName;
const params=new URLSearchParams(location.search);
if (params.has('room')) $('joinCode').value=params.get('room').toUpperCase().slice(0,6);

function toast(message) {
  $('toast').textContent=message; $('toast').classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),3500);
}
function connect(action, payload={}) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.close();
  intentionalExit=false;
  const protocol=location.protocol==='https:'?'wss:':'ws:';
  socket=new WebSocket(`${protocol}//${location.host}`);
  socket.addEventListener('open',()=>socket.send(JSON.stringify({action,...payload})));
  socket.addEventListener('message',event=>{
    let msg; try{msg=JSON.parse(event.data)}catch{return}
    if(msg.event==='error') {toast(msg.message); $('hostBtn').disabled=false; $('joinBtn').disabled=false;return}
    if(msg.event==='identity') {
      myId=msg.playerId;roomCode=msg.code;
      localStorage.setItem(`dots-token-${roomCode}`,msg.token);
      history.replaceState({},'',`/?room=${roomCode}`);
      $('welcome').classList.add('hidden');$('room').classList.remove('hidden');
      $('hostBtn').disabled=false;$('joinBtn').disabled=false;
      $('qr').src=`/api/qr?room=${roomCode}&origin=${encodeURIComponent(location.origin)}`;
    }
    if(msg.event==='state'){state=msg.state;render();}
  });
  socket.addEventListener('close',()=>{
    if(intentionalExit) return;
    if(!roomCode){$('hostBtn').disabled=false;$('joinBtn').disabled=false;toast('Connection lost. Try again.');return}
    toast('Connection lost. Reconnecting…');
    setTimeout(()=>{
      if(intentionalExit || !roomCode)return;
      connect('join',{code:roomCode,token:localStorage.getItem(`dots-token-${roomCode}`),name:localStorage.getItem('dots-name')||'Player'});
    },1800);
  });
  socket.addEventListener('error',()=>{});
}
function send(action, fields={}) {if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({action,...fields}));else toast('Not connected. Reconnecting…');}
$('hostBtn').addEventListener('click',()=>{
  const name=$('hostName').value.trim();if(!name)return toast('Enter your name first.');
  localStorage.setItem('dots-name',name);$('hostBtn').disabled=true;connect('create',{name});
});
$('joinBtn').addEventListener('click',join);
function join(){
  const name=$('joinName').value.trim(),code=$('joinCode').value.trim().toUpperCase();
  if(!name)return toast('Enter your name first.');if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))return toast('Enter a valid 6-character code.');
  localStorage.setItem('dots-name',name);$('joinBtn').disabled=true;
  connect('join',{name,code,token:localStorage.getItem(`dots-token-${code}`)});
}
$('joinCode').addEventListener('keydown',event=>{if(event.key==='Enter')join()});
$('copyBtn').addEventListener('click',async()=>{
  const link=`${location.origin}/?room=${roomCode}`;
  try{await navigator.clipboard.writeText(link);toast('Invite link copied!')}catch{prompt('Copy this invite link:',link)}
});
$('startBtn').addEventListener('click',()=>send('start'));
$('againBtn').addEventListener('click',()=>send('start'));
$('leaveBtn').addEventListener('click',()=>{
  intentionalExit=true; if(socket)socket.close();roomCode=null;myId=null;state=null;
  history.replaceState({},'','/');$('room').classList.add('hidden');$('welcome').classList.remove('hidden');
});

function render() {
  if(!state || !myId)return;
  $('displayCode').textContent=state.code;
  $('count').textContent=`${state.players.length} / ${state.maxPlayers}`;
  const host=state.hostId===myId;
  const lobby=state.status==='lobby';
  $('lobbyArea').classList.toggle('hidden',!lobby);
  $('playArea').classList.toggle('hidden',lobby);
  $('phase').textContent=lobby?'WAITING ROOM':state.status==='finished'?'GAME FINISHED':'GAME ON';
  $('roomTitle').textContent=lobby?'Your game room':state.status==='finished'?'That’s a wrap!':'Connect. Claim. Win.';
  $('roomSubtitle').textContent=lobby?'Share your code to bring everyone in.':'Every line counts. Make your move.';
  $('lobbyPlayers').replaceChildren(...state.players.map(player=>renderPlayer(player,false)));
  $('startBtn').classList.toggle('hidden',!host);
  $('startBtn').disabled=state.players.filter(p=>p.connected).length<2;
  $('hostHint').textContent=host?'You can start once at least two players have joined.':'The host will start when everyone is ready.';
  if(lobby)return;
  const current=state.players.find(p=>p.id===state.turnId);
  $('turnLabel').textContent=state.status==='finished'?'Final scores':current ? current.id===myId?'Your turn!':`${current.name}’s turn`:'Waiting for players…';
  $('turnLabel').style.color=current?.color||'var(--text)';
  $('scores').replaceChildren(...[...state.players].sort((a,b)=>b.score-a.score).map(player=>renderPlayer(player,true)));
  $('againBtn').classList.toggle('hidden',state.status!=='finished'||!host);
  const end=$('endBanner');end.classList.toggle('hidden',state.status!=='finished');
  if(state.status==='finished'){
    const winners=state.players.filter(p=>state.winnerIds.includes(p.id));
    end.textContent=winners.length>1?`Tie game! ${winners.map(p=>p.name).join(' & ')} share the win.`:`${winners[0]?.name||'Someone'} wins!`;
  }
  renderBoard();
}
function renderPlayer(player,showScore){
  const el=document.createElement('div');el.className='player-entry'+(player.id===state.turnId?' current':'');
  const avatar=document.createElement('div');avatar.className='avatar';avatar.style.setProperty('--player',player.color);avatar.textContent=player.name.charAt(0).toUpperCase();
  const body=document.createElement('div');body.className='person';body.textContent=player.name+(player.id===myId?' (you)':'');
  const detail=document.createElement('small');detail.textContent=player.id===state.hostId?'HOST':player.connected?'ONLINE':'OFFLINE';body.append(detail);
  el.append(avatar,body);
  if(showScore){const pts=document.createElement('div');pts.className='points';pts.textContent=player.score;el.append(pts)}
  return el;
}
function renderBoard(){
  const root=$('board'), {board,players}=state,size=board.size;
  root.replaceChildren();root.classList.toggle('can-play',state.status==='playing'&&state.turnId===myId);
  const playerColor=id=>players.find(p=>p.id===id)?.color||'#a7b5c4';
  const pad=5,span=90,step=span/(size-1),percent=(n)=>`${pad+n*step}%`;
  for(let r=0;r<size-1;r++)for(let c=0;c<size-1;c++){
    const owner=board.boxes[r][c];if(!owner)continue;
    const el=document.createElement('div');el.className='box-fill';el.style.left=percent(c+.5);el.style.top=percent(r+.5);
    el.style.width=`${step-2}%`;el.style.height=`${step-2}%`;
    el.style.setProperty('--box',playerColor(owner));el.textContent=players.find(p=>p.id===owner)?.name.charAt(0).toUpperCase()||'✓';root.append(el);
  }
  const addEdge=(orientation,r,c,owner)=>{
    const el=document.createElement('button');el.type='button';el.className=`edge ${orientation}${owner?' drawn':''}`;
    el.style.left=percent(orientation==='h'?c+.5:c);el.style.top=percent(orientation==='h'?r:r+.5);
    if(orientation==='h')el.style.width=`${step}%`;else el.style.height=`${step}%`;
    el.style.setProperty('--player',owner?playerColor(owner):'transparent');
    el.setAttribute('aria-label',`${owner?'Drawn':'Draw'} ${orientation==='h'?'horizontal':'vertical'} line row ${r+1} column ${c+1}`);
    el.disabled=!!owner||state.turnId!==myId||state.status!=='playing';
    if(!owner)el.addEventListener('click',()=>send('line',{orientation,row:r,col:c}));
    root.append(el);
  };
  for(let r=0;r<size;r++)for(let c=0;c<size-1;c++)addEdge('h',r,c,board.horizontal[r][c]);
  for(let r=0;r<size-1;r++)for(let c=0;c<size;c++)addEdge('v',r,c,board.vertical[r][c]);
  for(let r=0;r<size;r++)for(let c=0;c<size;c++){
    const el=document.createElement('div');el.className='dot';el.style.left=percent(c);el.style.top=percent(r);root.append(el);
  }
}
