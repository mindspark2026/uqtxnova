/* =========================================================
   TaskxNova — charts.js
   Gradient, animated Chart.js visualizations.
   ========================================================= */

const Charts = (function(){
  let distChart, waveChart, monthChart;

  function distribution(entries, catsMap){
    const byCat = {};
    Object.keys(catsMap).forEach(c => byCat[c] = 0);
    entries.forEach(e => byCat[e.cat] = (byCat[e.cat]||0) + e.dur);
    const labels = Object.keys(byCat).filter(c => byCat[c] > 0);
    const data = labels.map(l => byCat[l]);
    const colors = labels.map(l => catsMap[l]);

    const canvas = document.getElementById('distChart');
    if(!canvas) return;
    if(distChart) distChart.destroy();
    const ctx = canvas.getContext('2d');
    distChart = new Chart(ctx, {
      type:'doughnut',
      data:{
        labels: labels.length ? labels : ['No data'],
        datasets:[{
          data: labels.length ? data : [1],
          backgroundColor: labels.length ? colors : ['rgba(255,255,255,0.08)'],
          borderColor:'transparent',
          borderWidth:0,
          hoverOffset:6
        }]
      },
      options:{
        plugins:{
          legend:{display:false},
          tooltip:{ enabled:labels.length>0, callbacks:{ label: ctx => `${ctx.label}: ${Utils.formatDuration(ctx.raw)}` } }
        },
        cutout:'76%',
        animation:{ animateRotate:true, duration:700 }
      }
    });
    const legend = document.getElementById('distLegend');
    if(legend) legend.innerHTML = Object.keys(catsMap).map(c => `<span><i style="background:${catsMap[c]}"></i>${c}</span>`).join('');
  }

  function weeklyWave(entries){
    const canvas = document.getElementById('waveChart');
    if(!canvas) return;
    const days = [];
    for(let i=6;i>=0;i--){ const d = new Date(); d.setDate(d.getDate()-i); days.push(d); }
    const labels = days.map(d => d.toLocaleDateString(undefined,{weekday:'short'}).toUpperCase());
    const data = days.map(d => entries.filter(e => new Date(e.ts).toDateString() === d.toDateString()).reduce((s,e)=>s+e.dur,0));

    if(waveChart) waveChart.destroy();
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0,0,0,170);
    gradient.addColorStop(0,'rgba(108,99,255,0.4)');
    gradient.addColorStop(1,'rgba(108,99,255,0)');
    waveChart = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[{
        data, borderColor:'#7C5CFF', backgroundColor:gradient, fill:true,
        tension:0.4, pointBackgroundColor:'#7C5CFF', pointBorderColor:'#0c1120',
        pointBorderWidth:2, pointRadius:4, pointHoverRadius:7, borderWidth:2.5
      }]},
      options:{
        plugins:{
          legend:{display:false},
          tooltip:{ callbacks:{ label: ctx => Utils.formatDuration(ctx.parsed.y) } }
        },
        interaction:{ intersect:false, mode:'index' },
        animation:{ duration:700, easing:'easeOutQuart' },
        scales:{
          y:{ beginAtZero:true, suggestedMax:6, grid:{ color:'rgba(255,255,255,0.06)' }, ticks:{ stepSize:1, color:'#5D5D80', font:{family:'Space Grotesk',size:10}, callback:v=>Utils.formatDuration(v) } },
          x:{ grid:{ display:false }, ticks:{ color:'#5D5D80', font:{family:'Space Grotesk',size:10} } }
        }
      }
    });
  }

  function monthlyBars(entries){
    const canvas = document.getElementById('monthChart');
    if(!canvas) return;
    const now = new Date();
    const weeks = [0,0,0,0];
    entries.forEach(e => {
      const d = new Date(e.ts);
      if(d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return;
      const w = Math.min(3, Math.floor((d.getDate()-1)/7));
      weeks[w] += e.dur;
    });
    if(monthChart) monthChart.destroy();
    const ctx = canvas.getContext('2d');
    monthChart = new Chart(ctx, {
      type:'bar',
      data:{ labels:['Wk 1','Wk 2','Wk 3','Wk 4'], datasets:[{
        data: weeks, backgroundColor:'#6C63FF', borderRadius:8, maxBarThickness:34
      }]},
      options:{
        plugins:{
          legend:{display:false},
          tooltip:{ callbacks:{ label: ctx => Utils.formatDuration(ctx.parsed.y) } }
        },
        animation:{ duration:700 },
        scales:{
          y:{ beginAtZero:true, grid:{ color:'rgba(255,255,255,0.06)' }, ticks:{ color:'#5D5D80', font:{family:'Space Grotesk',size:10} } },
          x:{ grid:{ display:false }, ticks:{ color:'#5D5D80', font:{family:'Space Grotesk',size:10} } }
        }
      }
    });
  }

  function heatmap(entries){
    const box = document.getElementById('heatmapGrid');
    if(!box) return;
    const days = [];
    for(let i=181;i>=0;i--){ const d = new Date(); d.setDate(d.getDate()-i); days.push(d); }
    const byDay = {};
    entries.forEach(e => {
      const key = new Date(e.ts).toDateString();
      byDay[key] = (byDay[key]||0) + e.dur;
    });
    const max = Math.max(1, ...Object.values(byDay));
    box.innerHTML = days.map(d => {
      const v = byDay[d.toDateString()] || 0;
      const intensity = v === 0 ? 0 : Utils.clamp(Math.ceil((v/max)*4), 1, 4);
      const colors = ['rgba(255,255,255,0.06)','rgba(108,99,255,0.25)','rgba(108,99,255,0.5)','rgba(108,99,255,0.75)','rgba(108,99,255,1)'];
      return `<div class="heat-cell" style="background:${colors[intensity]}" title="${d.toDateString()}: ${Utils.formatDuration(v)}"></div>`;
    }).join('');
  }

  return { distribution, weeklyWave, monthlyBars, heatmap };
})();
