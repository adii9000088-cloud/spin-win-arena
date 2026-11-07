const $=id=>document.getElementById(id);
let state=null;
const socket=io();
function pin(){return $("pin").value.trim()}
async function api(path,body={}){
 const r=await fetch("/api/"+path,{method:"POST",headers:{"Content-Type":"application/json","x-admin-pin":pin()},body:JSON.stringify(body)});
 const data=await r.json(); if(!r.ok) throw new Error(data.error||"Request failed"); return data;
}
function notice(msg,isError=false){$("notice").textContent=msg;$("notice").style.color=isError?"#ff9c9c":"#9aabc6"}
function playerCard(id,name){$(id).querySelector("strong").textContent=name||"—"}
function render(s){
 state=s;
 $("round").textContent=s.champion?"TOURNAMENT COMPLETE":`ROUND ${s.round||1}`;
 $("status").textContent=s.champion?"CHAMPION CROWNED":s.current.length?"MATCH IN PROGRESS":s.remaining.length?"READY FOR NEXT SPIN":"WAITING FOR PLAYERS";
 playerCard("p1",s.current[0]);playerCard("p2",s.current[1]);
 $("count").textContent=s.remaining.length;
 $("players").innerHTML=s.remaining.length?s.remaining.map(n=>`<span class="chip">${esc(n)}</span>`).join(""):"No players loaded";
 $("champion").classList.toggle("hidden",!s.champion);
 if(s.champion)$("champion").querySelector("strong").textContent=s.champion;
 $("history").innerHTML=s.history.length?[...s.history].reverse().map((m,i)=>`<div class="matchrow"><span class="loser">${esc(m.loser)}</span><span>beat</span><span class="winner">${esc(m.winner)} ✓</span></div>`).join(""):'<div class="empty">Matches will appear here as they happen.</div>';
 $("win1").disabled=!s.current.length;$("win2").disabled=!s.current.length;
 $("win1").textContent=s.current[0]?`${s.current[0]} WON`:"PLAYER 1 WON";
 $("win2").textContent=s.current[1]?`${s.current[1]} WON`:"PLAYER 2 WON";
 $("spin").disabled=!!s.current.length||!!s.champion||s.remaining.length<2;
}
function esc(x){return String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
socket.on("state",render);
fetch("/api/state").then(r=>r.json()).then(render);
$("add").onclick=async()=>{try{const names=$("names").value.split(/\r?\n/);await api("players",{names});notice("Players added. Share this page with spectators.");}catch(e){notice(e.message,true)}};
$("spin").onclick=async()=>{try{notice("Spinning…");await api("spin");notice("Match selected. Play the match, then record the winner.");}catch(e){notice(e.message,true)}};
$("win1").onclick=()=>winner(0);$("win2").onclick=()=>winner(1);
async function winner(i){try{await api("winner",{winner:state.current[i]});notice("Winner qualified. The losing player has been eliminated.");}catch(e){notice(e.message,true)}}
$("reset").onclick=async()=>{if(!confirm("Reset the entire tournament?"))return;try{await api("reset");notice("Tournament reset.");}catch(e){notice(e.message,true)}}
