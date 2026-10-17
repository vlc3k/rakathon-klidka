// Sbalený boční panel (desktop). Stav je atribut data-sidebar="closed" na <html>, vzhled řeší CSS varianta `collapsed:`
// v app/globals.css. Volba se pamatuje v prohlížeči: je to jen pohodlí jednoho člověka na jednom počítači.
export const SIDEBAR_KEY = "klidka.sidebar";

// Běží v app/layout.tsx ještě před vykreslením stránky, aby sbalený panel při načtení neposkočil ze široké verze.
export const sidebarScript = `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_KEY)})==="closed")document.documentElement.dataset.sidebar="closed"}catch(e){}`;
