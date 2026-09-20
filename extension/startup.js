(() => {
  // Opacity keeps layout measurable so snapshot matching can run before reveal.
  let released=false, timer, observer, preparing=false;
  const style=document.createElement('style');
  style.setAttribute('data-jev-ui','startup');
  style.textContent='html{opacity:0!important;pointer-events:none!important}';
  function mount(){if(!released&&document.documentElement){document.documentElement.append(style);observer?.disconnect();}}
  function release(){if(released)return;released=true;clearTimeout(timer);observer?.disconnect();style.remove();}
  function prepare(apply){
    if(released||preparing)return;preparing=true;
    const reveal=()=>{try{apply();}finally{release();}};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reveal,{once:true});
    else reveal();
  }
  timer=setTimeout(release,1500);
  if(document.documentElement)mount();else{observer=new MutationObserver(mount);observer.observe(document,{childList:true});}
  globalThis.JevStartup={prepare,release};
})();
