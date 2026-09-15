/* data.js — turene appen kjenner til.
   Midlertidig: alt ligger i koden. Når backend kobles på erstattes denne
   filen av et kall til serveren; formen på objektene holdes lik. */

const TRIPS = {

  BERLIN26: {
    id: "berlin26",
    code: "BERLIN26",
    name: "Berlin 2026",
    org: "2STB Nordvang vgs",
    dates: "5.–9. oktober 2026",
    leaders: "Kari Lund og Tor-Helge Aas",

    places: {
      moabit: { name:"Hotel Moabit Plaza", addr:"Stromstraße 62, 10551 Berlin", kind:"Hotell",
                alias:["hotell","hotellet","moabit","lobby","lobbyen","resepsjonen"] },
      havel:  { name:"Pension Havelblick", addr:"Zeppelinstraße 136, 14471 Potsdam", kind:"Hotell",
                alias:["havelblick","pension","potsdam-hotellet"] },
      brand:  { name:"Brandenburger Tor", addr:"Pariser Platz, 10117 Berlin", kind:"Attraksjon",
                alias:["brandenburger","brandenburger tor","porten"] },
      mauer:  { name:"Gedenkstätte Berliner Mauer", addr:"Bernauer Straße 111, 13355 Berlin", kind:"Museum",
                alias:["muren","berlinmuren","mauer","minnesmerket","bernauer"] },
      tech:   { name:"Deutsches Technikmuseum", addr:"Trebbiner Straße 9, 10963 Berlin", kind:"Museum",
                alias:["teknisk museum","technikmuseum","teknikkmuseet"] },
      hbf:    { name:"Berlin Hauptbahnhof", addr:"Europaplatz 1, 10557 Berlin", kind:"Stasjon",
                alias:["hauptbahnhof","hbf","togstasjonen","hovedbanegården"] },
      sans:   { name:"Schloss Sanssouci", addr:"Maulbeerallee, 14469 Potsdam", kind:"Slott",
                alias:["sanssouci","slottet"] },
      osl:    { name:"Oslo lufthavn, terminal 2", addr:"Edvard Munchs veg, 2061 Gardermoen", kind:"Flyplass",
                alias:["gardermoen","flyplassen","osl","terminal 2"] }
    },

    days: [
      { date:"2026-10-05", chip:"Man", num:"5. okt", label:"mandag 5. oktober", hotel:"moabit", items:[
        { t:"05:40", title:"Oppmøte innsjekk", place:"osl", src:"Program_Berlin.pdf, s. 1" },
        { t:"08:10", title:"Fly SK 2683 til Berlin", place:null, note:"Gate oppgis på Gardermoen", src:"Flybilletter.pdf" },
        { t:"12:30", title:"Innsjekk hotell og romfordeling", place:"moabit", src:"Romfordeling.xlsx" },
        { t:"18:00", title:"Felles middag", place:"moabit", src:"Program_Berlin.pdf, s. 2" }
      ]},
      { date:"2026-10-06", chip:"Tir", num:"6. okt", label:"tirsdag 6. oktober", hotel:"moabit", items:[
        { t:"07:45", title:"Frokost, så avreise fra lobbyen", place:"moabit", src:"Program_Berlin.pdf, s. 2" },
        { t:"09:30", title:"Omvisning Berlinmuren", place:"mauer", src:"Program_Berlin.pdf, s. 2" },
        { t:"12:15", title:"Lunsj på egen hånd", place:null, note:"Møtes igjen 13:45", src:"Program_Berlin.pdf, s. 2" },
        { t:"14:00", title:"Gruppeoppgave: fotodokumentasjon", place:"brand", src:"Oppgavehefte.docx" },
        { t:"18:30", title:"Kveldsmat på hotellet", place:"moabit", src:"Program_Berlin.pdf, s. 3" }
      ]},
      { date:"2026-10-07", chip:"Ons", num:"7. okt", label:"onsdag 7. oktober", hotel:"moabit", items:[
        { t:"09:00", title:"Deutsches Technikmuseum", place:"tech", src:"Program_Berlin.pdf, s. 3" },
        { t:"15:00", title:"Fritid i grupper", place:null, note:"Minst tre sammen", src:"Turregler.pdf" },
        { t:"20:00", title:"Innetid", place:"moabit", src:"Turregler.pdf" }
      ]},
      { date:"2026-10-08", chip:"Tor", num:"8. okt", label:"torsdag 8. oktober", hotel:"havel", items:[
        { t:"08:30", title:"Utsjekk, bagasje på buss", place:"moabit", src:"Bussplan.docx" },
        { t:"10:45", title:"Tog til Potsdam", place:"hbf", src:"Bussplan.docx" },
        { t:"13:00", title:"Innsjekk Potsdam", place:"havel", src:"Romfordeling.xlsx" },
        { t:"15:00", title:"Schloss Sanssouci", place:"sans", src:"Program_Berlin.pdf, s. 4" }
      ]},
      { date:"2026-10-09", chip:"Fre", num:"9. okt", label:"fredag 9. oktober", hotel:"havel", items:[
        { t:"09:15", title:"Utsjekk og avreise", place:"havel", src:"Program_Berlin.pdf, s. 4" },
        { t:"14:20", title:"Fly SK 2684 til Oslo", place:null, src:"Flybilletter.pdf" }
      ]}
    ],

    files: [
      { name:"Program_Berlin.pdf", type:"pdf", by:"Kari Lund", when:"12. sep", read:"17 programpunkter · 2 hoteller" },
      { name:"Romfordeling.xlsx", type:"xls", by:"Kari Lund", when:"20. sep", read:"28 navn · 7 rom" },
      { name:"Bussplan.docx", type:"doc", by:"Tor-Helge Aas", when:"24. sep", read:"3 avganger · 2 møtepunkter" },
      { name:"Turregler.pdf", type:"pdf", by:"Kari Lund", when:"26. sep", read:"Innetid 20:00 · kontaktliste" },
      { name:"Flybilletter.pdf", type:"pdf", by:"Kari Lund", when:"1. okt", read:"2 flyvninger · ref. RTX4QK" }
    ],

    channels: [
      { id:"alle", name:"Hele turen", sub:"28 deltakere", seed:[
        { who:"Kari Lund", role:"Reiseleder", txt:"Velkommen inn i appen! Alt av program ligger under Program. Si fra hvis noe mangler.", t:"-3d" },
        { who:"Kari Lund", role:"Reiseleder", txt:"Vi møtes i lobbyen på hotellet 07:45 på tirsdag — vær presis, bussen venter ikke.", t:"-2d" },
        { who:"Tor-Helge Aas", role:"Reiseleder", txt:"Husk varme klær, omvisningen ved muren er utendørs og varer halvannen time.", t:"-1d" }
      ]},
      { id:"muren", name:"Gruppe muren", sub:"Fotooppgave · 6 stk", seed:[
        { who:"Noah B.", role:"Gruppe muren", txt:"Vi tar oppgaven ved Brandenburger Tor kl 14:00, greit for alle?", t:"-1d" },
        { who:"Sara M.", role:"Gruppe muren", txt:"Greit. Jeg tar med powerbank til kameraet.", t:"-20h" }
      ]},
      { id:"museum", name:"Gruppe museum", sub:"Technikmuseum · 5 stk", seed:[
        { who:"Emma S.", role:"Gruppe museum", txt:"Møtes vi rett på Deutsches Technikmuseum 09:00, eller går vi sammen fra hotellet?", t:"-18h" }
      ]},
      { id:"ledere", name:"Reiseledere", sub:"Kari, Tor-Helge", seed:[
        { who:"Kari Lund", role:"Reiseleder", txt:"Sjekkliste torsdag: bagasje ned i lobbyen 08:30, jeg teller hoder på bussen.", t:"-6h" }
      ]}
    ]
  },

  PARIS26: {
    id: "paris26",
    code: "PARIS26",
    name: "Paris 2026",
    org: "3MDA Nordvang vgs",
    dates: "9.–13. november 2026",
    leaders: "Ingvild Sæther",

    places: {
      lafayette: { name:"Hôtel Lafayette Nord", addr:"18 Rue de Dunkerque, 75010 Paris", kind:"Hotell",
                   alias:["hotell","hotellet","lafayette","lobby","lobbyen","resepsjonen"] },
      eiffel:    { name:"Eiffeltårnet", addr:"Champ de Mars, 5 Avenue Anatole France, 75007 Paris", kind:"Attraksjon",
                   alias:["eiffel","eiffeltårnet","tårnet","tour eiffel"] },
      louvre:    { name:"Musée du Louvre", addr:"Rue de Rivoli, 75001 Paris", kind:"Museum",
                   alias:["louvre","museet","musée du louvre"] },
      orsay:     { name:"Musée d'Orsay", addr:"1 Rue de la Légion d'Honneur, 75007 Paris", kind:"Museum",
                   alias:["orsay","d'orsay"] },
      nord:      { name:"Gare du Nord", addr:"18 Rue de Dunkerque, 75010 Paris", kind:"Stasjon",
                   alias:["gare du nord","togstasjonen","nord"] },
      sacre:     { name:"Sacré-Cœur", addr:"35 Rue du Chevalier de la Barre, 75018 Paris", kind:"Kirke",
                   alias:["sacre","sacré-cœur","montmartre","kirken"] },
      cdg:       { name:"Paris Charles de Gaulle, terminal 2E", addr:"95700 Roissy-en-France", kind:"Flyplass",
                   alias:["charles de gaulle","cdg","flyplassen"] },
      osl:       { name:"Oslo lufthavn, terminal 2", addr:"Edvard Munchs veg, 2061 Gardermoen", kind:"Flyplass",
                   alias:["gardermoen","osl","terminal 2"] }
    },

    days: [
      { date:"2026-11-09", chip:"Man", num:"9. nov", label:"mandag 9. november", hotel:"lafayette", items:[
        { t:"06:00", title:"Oppmøte innsjekk", place:"osl", src:"Program_Paris.pdf, s. 1" },
        { t:"08:45", title:"Fly AF 1175 til Paris", place:null, src:"Flybilletter_Paris.pdf" },
        { t:"13:30", title:"Innsjekk hotell", place:"lafayette", src:"Romfordeling_Paris.xlsx" },
        { t:"17:00", title:"Bli kjent-tur i nabolaget", place:"nord", src:"Program_Paris.pdf, s. 1" }
      ]},
      { date:"2026-11-10", chip:"Tir", num:"10. nov", label:"tirsdag 10. november", hotel:"lafayette", items:[
        { t:"08:15", title:"Avreise fra lobbyen", place:"lafayette", src:"Program_Paris.pdf, s. 2" },
        { t:"10:00", title:"Louvre — kunsthistorie", place:"louvre", src:"Program_Paris.pdf, s. 2" },
        { t:"14:00", title:"Eiffeltårnet, oppstigning", place:"eiffel", src:"Billetter_Eiffel.pdf" },
        { t:"19:00", title:"Middag på hotellet", place:"lafayette", src:"Program_Paris.pdf, s. 2" }
      ]},
      { date:"2026-11-11", chip:"Ons", num:"11. nov", label:"onsdag 11. november", hotel:"lafayette", items:[
        { t:"09:30", title:"Gruppedag — museum eller Eiffel", place:null, note:"Gruppene velger selv, se gruppechat", src:"Oppgavehefte_Paris.docx" },
        { t:"16:30", title:"Felles samling Sacré-Cœur", place:"sacre", src:"Program_Paris.pdf, s. 3" },
        { t:"21:00", title:"Innetid", place:"lafayette", src:"Turregler_Paris.pdf" }
      ]},
      { date:"2026-11-12", chip:"Tor", num:"12. nov", label:"torsdag 12. november", hotel:"lafayette", items:[
        { t:"10:00", title:"Musée d'Orsay", place:"orsay", src:"Program_Paris.pdf, s. 3" },
        { t:"14:00", title:"Fritid i grupper", place:null, note:"Minst tre sammen", src:"Turregler_Paris.pdf" }
      ]},
      { date:"2026-11-13", chip:"Fre", num:"13. nov", label:"fredag 13. november", hotel:"lafayette", items:[
        { t:"08:00", title:"Utsjekk", place:"lafayette", src:"Program_Paris.pdf, s. 4" },
        { t:"12:40", title:"Fly AF 1174 til Oslo", place:"cdg", src:"Flybilletter_Paris.pdf" }
      ]}
    ],

    files: [
      { name:"Program_Paris.pdf", type:"pdf", by:"Ingvild Sæther", when:"3. okt", read:"15 programpunkter · 1 hotell" },
      { name:"Romfordeling_Paris.xlsx", type:"xls", by:"Ingvild Sæther", when:"8. okt", read:"24 navn · 6 rom" },
      { name:"Billetter_Eiffel.pdf", type:"pdf", by:"Ingvild Sæther", when:"14. okt", read:"24 billetter · tidsluke 14:00" },
      { name:"Turregler_Paris.pdf", type:"pdf", by:"Ingvild Sæther", when:"15. okt", read:"Innetid 21:00 · kontaktliste" }
    ],

    channels: [
      { id:"alle", name:"Hele turen", sub:"24 deltakere", seed:[
        { who:"Ingvild Sæther", role:"Reiseleder", txt:"Onsdag er gruppedag. Bruk gruppechattene til å avtale møtested og tid.", t:"-2d" }
      ]},
      { id:"eiffel", name:"Gruppe Eiffeltårnet", sub:"Onsdag · 12 stk", seed:[
        { who:"Jonas H.", role:"Gruppe Eiffel", txt:"Vi møtes ved Eiffeltårnet kl 10:30 på onsdag, så slipper vi køen.", t:"-1d" },
        { who:"Mina K.", role:"Gruppe Eiffel", txt:"Perfekt. Tar metro linje 6 fra hotellet.", t:"-22h" }
      ]},
      { id:"louvre", name:"Gruppe museum", sub:"Onsdag · 12 stk", seed:[
        { who:"Aksel R.", role:"Gruppe museum", txt:"Vår gruppe tar Louvre. Møt utenfor pyramiden kl 11:00 onsdag.", t:"-1d" }
      ]},
      { id:"ledere", name:"Reiseledere", sub:"Ingvild", seed:[
        { who:"Ingvild Sæther", role:"Reiseleder", txt:"Husk å telle opp begge gruppene før vi samles på Sacré-Cœur 16:30.", t:"-8h" }
      ]}
    ]
  }
};

function tripByCode(code) {
  const k = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  return TRIPS[k] || null;
}
function tripById(id) {
  return Object.values(TRIPS).find(t => t.id === id) || null;
}
