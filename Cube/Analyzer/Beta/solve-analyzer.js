(() => {
  'use strict';

  const ANALYSIS_VERSION = 6;
  const PAUSE_MS = 400;
  const STANDARD_CASES = {"OLL":{"1":{"name":"OLL 24","index":23,"type":"OCLL"},"2":{"name":"OLL 23","index":22,"type":"OCLL"},"3":{"name":"OLL 25","index":24,"type":"OCLL"},"4":{"name":"OLL 27","index":26,"type":"OCLL"},"5":{"name":"OLL 24","index":23,"type":"OCLL"},"6":{"name":"OLL 25","index":24,"type":"OCLL"},"7":{"name":"OLL 23","index":22,"type":"OCLL"},"8":{"name":"OLL 26","index":25,"type":"OCLL"},"9":{"name":"OLL 23","index":22,"type":"OCLL"},"10":{"name":"OLL 27","index":26,"type":"OCLL"},"11":{"name":"OLL 25","index":24,"type":"OCLL"},"12":{"name":"OLL 27","index":26,"type":"OCLL"},"13":{"name":"OLL 27","index":26,"type":"OCLL"},"14":{"name":"OLL 22","index":21,"type":"OCLL"},"15":{"name":"OLL 24","index":23,"type":"OCLL"},"16":{"name":"OLL 21","index":20,"type":"OCLL"},"17":{"name":"OLL 22","index":21,"type":"OCLL"},"18":{"name":"OLL 24","index":23,"type":"OCLL"},"19":{"name":"OLL 25","index":24,"type":"OCLL"},"20":{"name":"OLL 26","index":25,"type":"OCLL"},"21":{"name":"OLL 23","index":22,"type":"OCLL"},"22":{"name":"OLL 22","index":21,"type":"OCLL"},"23":{"name":"OLL 21","index":20,"type":"OCLL"},"24":{"name":"OLL 26","index":25,"type":"OCLL"},"25":{"name":"OLL 22","index":21,"type":"OCLL"},"26":{"name":"OLL 26","index":25,"type":"OCLL"},"80":{"name":"OLL 28","index":27,"type":"All Corner Oriented"},"81":{"name":"OLL 32","index":31,"type":"P Shapes"},"82":{"name":"OLL 44","index":43,"type":"P Shapes"},"83":{"name":"OLL 35","index":34,"type":"Fish Shapes"},"84":{"name":"OLL 5","index":4,"type":"Square Shapes"},"85":{"name":"OLL 31","index":30,"type":"P Shapes"},"86":{"name":"OLL 37","index":36,"type":"Fish Shapes"},"87":{"name":"OLL 43","index":42,"type":"P Shapes"},"88":{"name":"OLL 6","index":5,"type":"Square Shapes"},"89":{"name":"OLL 41","index":40,"type":"Awkward Shapes"},"90":{"name":"OLL 7","index":6,"type":"Lightning Shapes"},"91":{"name":"OLL 38","index":37,"type":"W Shapes"},"92":{"name":"OLL 10","index":9,"type":"Fish Shapes"},"93":{"name":"OLL 11","index":10,"type":"Lightning Shapes"},"94":{"name":"OLL 47","index":46,"type":"L Shapes"},"95":{"name":"OLL 29","index":28,"type":"Awkward Shapes"},"96":{"name":"OLL 54","index":53,"type":"L Shapes"},"97":{"name":"OLL 50","index":49,"type":"L Shapes"},"98":{"name":"OLL 30","index":29,"type":"Awkward Shapes"},"99":{"name":"OLL 36","index":35,"type":"W Shapes"},"100":{"name":"OLL 12","index":11,"type":"Lightning Shapes"},"101":{"name":"OLL 42","index":41,"type":"Awkward Shapes"},"102":{"name":"OLL 48","index":47,"type":"L Shapes"},"103":{"name":"OLL 53","index":52,"type":"L Shapes"},"104":{"name":"OLL 9","index":8,"type":"Fish Shapes"},"105":{"name":"OLL 49","index":48,"type":"L Shapes"},"106":{"name":"OLL 8","index":7,"type":"Lightning Shapes"},"160":{"name":"OLL 57","index":56,"type":"All Corner Oriented"},"161":{"name":"OLL 34","index":33,"type":"C Shapes"},"162":{"name":"OLL 46","index":45,"type":"C Shapes"},"163":{"name":"OLL 39","index":38,"type":"Lightning Shapes"},"164":{"name":"OLL 13","index":12,"type":"Knight Move Shapes"},"165":{"name":"OLL 33","index":32,"type":"T Shapes"},"166":{"name":"OLL 39","index":38,"type":"Lightning Shapes"},"167":{"name":"OLL 45","index":44,"type":"T Shapes"},"168":{"name":"OLL 16","index":15,"type":"Knight Move Shapes"},"169":{"name":"OLL 45","index":44,"type":"T Shapes"},"170":{"name":"OLL 15","index":14,"type":"Knight Move Shapes"},"171":{"name":"OLL 40","index":39,"type":"Lightning Shapes"},"172":{"name":"OLL 13","index":12,"type":"Knight Move Shapes"},"173":{"name":"OLL 15","index":14,"type":"Knight Move Shapes"},"174":{"name":"OLL 51","index":50,"type":"Line Shapes"},"175":{"name":"OLL 34","index":33,"type":"C Shapes"},"176":{"name":"OLL 56","index":55,"type":"Line Shapes"},"177":{"name":"OLL 52","index":51,"type":"Line Shapes"},"178":{"name":"OLL 33","index":32,"type":"T Shapes"},"179":{"name":"OLL 40","index":39,"type":"Lightning Shapes"},"180":{"name":"OLL 14","index":13,"type":"Knight Move Shapes"},"181":{"name":"OLL 46","index":45,"type":"C Shapes"},"182":{"name":"OLL 52","index":51,"type":"Line Shapes"},"183":{"name":"OLL 55","index":54,"type":"Line Shapes"},"184":{"name":"OLL 16","index":15,"type":"Knight Move Shapes"},"185":{"name":"OLL 51","index":50,"type":"Line Shapes"},"186":{"name":"OLL 14","index":13,"type":"Knight Move Shapes"},"240":{"name":"OLL 28","index":27,"type":"All Corner Oriented"},"241":{"name":"OLL 30","index":29,"type":"Awkward Shapes"},"242":{"name":"OLL 41","index":40,"type":"Awkward Shapes"},"243":{"name":"OLL 36","index":35,"type":"W Shapes"},"244":{"name":"OLL 7","index":6,"type":"Lightning Shapes"},"245":{"name":"OLL 32","index":31,"type":"P Shapes"},"246":{"name":"OLL 38","index":37,"type":"W Shapes"},"247":{"name":"OLL 44","index":43,"type":"P Shapes"},"248":{"name":"OLL 12","index":11,"type":"Lightning Shapes"},"249":{"name":"OLL 42","index":41,"type":"Awkward Shapes"},"250":{"name":"OLL 10","index":9,"type":"Fish Shapes"},"251":{"name":"OLL 35","index":34,"type":"Fish Shapes"},"252":{"name":"OLL 11","index":10,"type":"Lightning Shapes"},"253":{"name":"OLL 5","index":4,"type":"Square Shapes"},"254":{"name":"OLL 48","index":47,"type":"L Shapes"},"255":{"name":"OLL 31","index":30,"type":"P Shapes"},"256":{"name":"OLL 53","index":52,"type":"L Shapes"},"257":{"name":"OLL 47","index":46,"type":"L Shapes"},"258":{"name":"OLL 29","index":28,"type":"Awkward Shapes"},"259":{"name":"OLL 37","index":36,"type":"Fish Shapes"},"260":{"name":"OLL 9","index":8,"type":"Fish Shapes"},"261":{"name":"OLL 43","index":42,"type":"P Shapes"},"262":{"name":"OLL 49","index":48,"type":"L Shapes"},"263":{"name":"OLL 54","index":53,"type":"L Shapes"},"264":{"name":"OLL 8","index":7,"type":"Lightning Shapes"},"265":{"name":"OLL 50","index":49,"type":"L Shapes"},"266":{"name":"OLL 6","index":5,"type":"Square Shapes"},"320":{"name":"OLL 28","index":27,"type":"All Corner Oriented"},"321":{"name":"OLL 31","index":30,"type":"P Shapes"},"322":{"name":"OLL 43","index":42,"type":"P Shapes"},"323":{"name":"OLL 38","index":37,"type":"W Shapes"},"324":{"name":"OLL 11","index":10,"type":"Lightning Shapes"},"325":{"name":"OLL 29","index":28,"type":"Awkward Shapes"},"326":{"name":"OLL 36","index":35,"type":"W Shapes"},"327":{"name":"OLL 42","index":41,"type":"Awkward Shapes"},"328":{"name":"OLL 8","index":7,"type":"Lightning Shapes"},"329":{"name":"OLL 44","index":43,"type":"P Shapes"},"330":{"name":"OLL 5","index":4,"type":"Square Shapes"},"331":{"name":"OLL 37","index":36,"type":"Fish Shapes"},"332":{"name":"OLL 7","index":6,"type":"Lightning Shapes"},"333":{"name":"OLL 10","index":9,"type":"Fish Shapes"},"334":{"name":"OLL 50","index":49,"type":"L Shapes"},"335":{"name":"OLL 30","index":29,"type":"Awkward Shapes"},"336":{"name":"OLL 53","index":52,"type":"L Shapes"},"337":{"name":"OLL 49","index":48,"type":"L Shapes"},"338":{"name":"OLL 32","index":31,"type":"P Shapes"},"339":{"name":"OLL 35","index":34,"type":"Fish Shapes"},"340":{"name":"OLL 6","index":5,"type":"Square Shapes"},"341":{"name":"OLL 41","index":40,"type":"Awkward Shapes"},"342":{"name":"OLL 47","index":46,"type":"L Shapes"},"343":{"name":"OLL 54","index":53,"type":"L Shapes"},"344":{"name":"OLL 12","index":11,"type":"Lightning Shapes"},"345":{"name":"OLL 48","index":47,"type":"L Shapes"},"346":{"name":"OLL 9","index":8,"type":"Fish Shapes"},"400":{"name":"OLL 57","index":56,"type":"All Corner Oriented"},"401":{"name":"OLL 33","index":32,"type":"T Shapes"},"402":{"name":"OLL 45","index":44,"type":"T Shapes"},"403":{"name":"OLL 40","index":39,"type":"Lightning Shapes"},"404":{"name":"OLL 15","index":14,"type":"Knight Move Shapes"},"405":{"name":"OLL 34","index":33,"type":"C Shapes"},"406":{"name":"OLL 40","index":39,"type":"Lightning Shapes"},"407":{"name":"OLL 46","index":45,"type":"C Shapes"},"408":{"name":"OLL 14","index":13,"type":"Knight Move Shapes"},"409":{"name":"OLL 46","index":45,"type":"C Shapes"},"410":{"name":"OLL 13","index":12,"type":"Knight Move Shapes"},"411":{"name":"OLL 39","index":38,"type":"Lightning Shapes"},"412":{"name":"OLL 15","index":14,"type":"Knight Move Shapes"},"413":{"name":"OLL 13","index":12,"type":"Knight Move Shapes"},"414":{"name":"OLL 52","index":51,"type":"Line Shapes"},"415":{"name":"OLL 33","index":32,"type":"T Shapes"},"416":{"name":"OLL 55","index":54,"type":"Line Shapes"},"417":{"name":"OLL 51","index":50,"type":"Line Shapes"},"418":{"name":"OLL 34","index":33,"type":"C Shapes"},"419":{"name":"OLL 39","index":38,"type":"Lightning Shapes"},"420":{"name":"OLL 16","index":15,"type":"Knight Move Shapes"},"421":{"name":"OLL 45","index":44,"type":"T Shapes"},"422":{"name":"OLL 51","index":50,"type":"Line Shapes"},"423":{"name":"OLL 56","index":55,"type":"Line Shapes"},"424":{"name":"OLL 14","index":13,"type":"Knight Move Shapes"},"425":{"name":"OLL 52","index":51,"type":"Line Shapes"},"426":{"name":"OLL 16","index":15,"type":"Knight Move Shapes"},"480":{"name":"OLL 28","index":27,"type":"All Corner Oriented"},"481":{"name":"OLL 29","index":28,"type":"Awkward Shapes"},"482":{"name":"OLL 42","index":41,"type":"Awkward Shapes"},"483":{"name":"OLL 37","index":36,"type":"Fish Shapes"},"484":{"name":"OLL 10","index":9,"type":"Fish Shapes"},"485":{"name":"OLL 30","index":29,"type":"Awkward Shapes"},"486":{"name":"OLL 35","index":34,"type":"Fish Shapes"},"487":{"name":"OLL 41","index":40,"type":"Awkward Shapes"},"488":{"name":"OLL 9","index":8,"type":"Fish Shapes"},"489":{"name":"OLL 43","index":42,"type":"P Shapes"},"490":{"name":"OLL 11","index":10,"type":"Lightning Shapes"},"491":{"name":"OLL 36","index":35,"type":"W Shapes"},"492":{"name":"OLL 5","index":4,"type":"Square Shapes"},"493":{"name":"OLL 7","index":6,"type":"Lightning Shapes"},"494":{"name":"OLL 49","index":48,"type":"L Shapes"},"495":{"name":"OLL 32","index":31,"type":"P Shapes"},"496":{"name":"OLL 54","index":53,"type":"L Shapes"},"497":{"name":"OLL 48","index":47,"type":"L Shapes"},"498":{"name":"OLL 31","index":30,"type":"P Shapes"},"499":{"name":"OLL 38","index":37,"type":"W Shapes"},"500":{"name":"OLL 8","index":7,"type":"Lightning Shapes"},"501":{"name":"OLL 44","index":43,"type":"P Shapes"},"502":{"name":"OLL 50","index":49,"type":"L Shapes"},"503":{"name":"OLL 53","index":52,"type":"L Shapes"},"504":{"name":"OLL 6","index":5,"type":"Square Shapes"},"505":{"name":"OLL 47","index":46,"type":"L Shapes"},"506":{"name":"OLL 12","index":11,"type":"Lightning Shapes"},"560":{"name":"OLL 20","index":19,"type":"Dot Case"},"561":{"name":"OLL 19","index":18,"type":"Dot Case"},"562":{"name":"OLL 18","index":17,"type":"Dot Case"},"563":{"name":"OLL 17","index":16,"type":"Dot Case"},"564":{"name":"OLL 3","index":2,"type":"Dot Case"},"565":{"name":"OLL 19","index":18,"type":"Dot Case"},"566":{"name":"OLL 17","index":16,"type":"Dot Case"},"567":{"name":"OLL 18","index":17,"type":"Dot Case"},"568":{"name":"OLL 4","index":3,"type":"Dot Case"},"569":{"name":"OLL 18","index":17,"type":"Dot Case"},"570":{"name":"OLL 3","index":2,"type":"Dot Case"},"571":{"name":"OLL 17","index":16,"type":"Dot Case"},"572":{"name":"OLL 3","index":2,"type":"Dot Case"},"573":{"name":"OLL 3","index":2,"type":"Dot Case"},"574":{"name":"OLL 2","index":1,"type":"Dot Case"},"575":{"name":"OLL 19","index":18,"type":"Dot Case"},"576":{"name":"OLL 1","index":0,"type":"Dot Case"},"577":{"name":"OLL 2","index":1,"type":"Dot Case"},"578":{"name":"OLL 19","index":18,"type":"Dot Case"},"579":{"name":"OLL 17","index":16,"type":"Dot Case"},"580":{"name":"OLL 4","index":3,"type":"Dot Case"},"581":{"name":"OLL 18","index":17,"type":"Dot Case"},"582":{"name":"OLL 2","index":1,"type":"Dot Case"},"583":{"name":"OLL 1","index":0,"type":"Dot Case"},"584":{"name":"OLL 4","index":3,"type":"Dot Case"},"585":{"name":"OLL 2","index":1,"type":"Dot Case"},"586":{"name":"OLL 4","index":3,"type":"Dot Case"}},"PLL":{"3":{"name":"Ub","index":17,"type":"EPLL"},"4":{"name":"Ua","index":16,"type":"EPLL"},"7":{"name":"Z","index":20,"type":"EPLL"},"8":{"name":"Ub","index":17,"type":"EPLL"},"11":{"name":"Ub","index":17,"type":"EPLL"},"12":{"name":"Ua","index":16,"type":"EPLL"},"15":{"name":"Ub","index":17,"type":"EPLL"},"16":{"name":"H","index":8,"type":"EPLL"},"19":{"name":"Ua","index":16,"type":"EPLL"},"20":{"name":"Ua","index":16,"type":"EPLL"},"23":{"name":"Z","index":20,"type":"EPLL"},"25":{"name":"Jb","index":10,"type":"adjacent swap"},"26":{"name":"Ja","index":9,"type":"adjacent swap"},"29":{"name":"F","index":3,"type":"adjacent swap"},"30":{"name":"Ra","index":13,"type":"adjacent swap"},"33":{"name":"Ab","index":1,"type":"adjacent swap"},"34":{"name":"Ga","index":4,"type":"adjacent swap"},"37":{"name":"Gb","index":5,"type":"adjacent swap"},"38":{"name":"T","index":15,"type":"adjacent swap"},"41":{"name":"Gd","index":7,"type":"adjacent swap"},"42":{"name":"Aa","index":0,"type":"adjacent swap"},"45":{"name":"Rb","index":14,"type":"adjacent swap"},"46":{"name":"Gc","index":6,"type":"adjacent swap"},"49":{"name":"Rb","index":14,"type":"adjacent swap"},"50":{"name":"Jb","index":10,"type":"adjacent swap"},"53":{"name":"T","index":15,"type":"adjacent swap"},"54":{"name":"Ja","index":9,"type":"adjacent swap"},"57":{"name":"Ab","index":1,"type":"adjacent swap"},"58":{"name":"Gc","index":6,"type":"adjacent swap"},"61":{"name":"Gd","index":7,"type":"adjacent swap"},"62":{"name":"F","index":3,"type":"adjacent swap"},"65":{"name":"Ga","index":4,"type":"adjacent swap"},"66":{"name":"Aa","index":0,"type":"adjacent swap"},"69":{"name":"Ra","index":13,"type":"adjacent swap"},"70":{"name":"Gb","index":5,"type":"adjacent swap"},"72":{"name":"Aa","index":0,"type":"adjacent swap"},"75":{"name":"Jb","index":10,"type":"adjacent swap"},"76":{"name":"Ga","index":4,"type":"adjacent swap"},"79":{"name":"T","index":15,"type":"adjacent swap"},"80":{"name":"Ja","index":9,"type":"adjacent swap"},"83":{"name":"Ra","index":13,"type":"adjacent swap"},"84":{"name":"Gd","index":7,"type":"adjacent swap"},"87":{"name":"Rb","index":14,"type":"adjacent swap"},"88":{"name":"Ab","index":1,"type":"adjacent swap"},"91":{"name":"Gb","index":5,"type":"adjacent swap"},"92":{"name":"Gc","index":6,"type":"adjacent swap"},"95":{"name":"F","index":3,"type":"adjacent swap"},"96":{"name":"Ab","index":1,"type":"adjacent swap"},"99":{"name":"Gb","index":5,"type":"adjacent swap"},"100":{"name":"Jb","index":10,"type":"adjacent swap"},"103":{"name":"T","index":15,"type":"adjacent swap"},"104":{"name":"Gc","index":6,"type":"adjacent swap"},"107":{"name":"Ga","index":4,"type":"adjacent swap"},"108":{"name":"Ja","index":9,"type":"adjacent swap"},"111":{"name":"Gd","index":7,"type":"adjacent swap"},"112":{"name":"Aa","index":0,"type":"adjacent swap"},"115":{"name":"Ra","index":13,"type":"adjacent swap"},"116":{"name":"Rb","index":14,"type":"adjacent swap"},"119":{"name":"F","index":3,"type":"adjacent swap"},"121":{"name":"Y","index":19,"type":"opposite swap"},"122":{"name":"V","index":18,"type":"EPLL"},"125":{"name":"Na","index":11,"type":"opposite swap"},"126":{"name":"Y","index":19,"type":"opposite swap"},"129":{"name":"E","index":2,"type":"opposite swap"},"130":{"name":"Y","index":19,"type":"opposite swap"},"133":{"name":"Y","index":19,"type":"opposite swap"},"134":{"name":"Nb","index":12,"type":"opposite swap"},"137":{"name":"V","index":18,"type":"EPLL"},"138":{"name":"E","index":2,"type":"opposite swap"},"141":{"name":"V","index":18,"type":"EPLL"},"142":{"name":"V","index":18,"type":"EPLL"}},"F2L":{"0":{"name":"F2L 23","index":0,"type":"Connected Pairs"},"1":{"name":"F2L 18","index":1,"type":"Connected Pairs"},"2":{"name":"F2L 15","index":2,"type":"Connected Pairs"},"3":{"name":"F2L 13","index":3,"type":"Connected Pairs"},"4":{"name":"F2L 12","index":4,"type":"Connected Pairs"},"5":{"name":"F2L 2","index":5,"type":"Free Pairs"},"6":{"name":"F2L 21","index":6,"type":"Disconnected Pairs"},"7":{"name":"F2L 20","index":7,"type":"Disconnected Pairs"},"8":{"name":"F2L 7","index":8,"type":"Disconnected Pairs"},"9":{"name":"F2L 3","index":9,"type":"Free Pairs"},"10":{"name":"F2L 10","index":10,"type":"Disconnected Pairs"},"11":{"name":"F2L 6","index":11,"type":"Disconnected Pairs"},"12":{"name":"F2L 19","index":12,"type":"Disconnected Pairs"},"13":{"name":"F2L 22","index":13,"type":"Disconnected Pairs"},"14":{"name":"F2L 5","index":14,"type":"Disconnected Pairs"},"15":{"name":"F2L 9","index":15,"type":"Disconnected Pairs"},"16":{"name":"F2L 4","index":16,"type":"Free Pairs"},"17":{"name":"F2L 8","index":17,"type":"Disconnected Pairs"},"18":{"name":"F2L 17","index":18,"type":"Connected Pairs"},"19":{"name":"F2L 24","index":19,"type":"Connected Pairs"},"20":{"name":"F2L 1","index":20,"type":"Free Pairs"},"21":{"name":"F2L 11","index":21,"type":"Connected Pairs"},"22":{"name":"F2L 14","index":22,"type":"Connected Pairs"},"23":{"name":"F2L 16","index":23,"type":"Connected Pairs"},"24":{"name":"AF2L 24","index":24,"type":"Trapped Edge"},"25":{"name":"AF2L 15","index":25,"type":"Trapped Edge"},"26":{"name":"AF2L 12","index":26,"type":"Trapped Edge"},"27":{"name":"AF2L 18","index":27,"type":"Trapped Edge"},"28":{"name":"AF2L 43","index":28,"type":"Trapped Edge"},"29":{"name":"AF2L 21","index":29,"type":"Trapped Edge"},"30":{"name":"F2L 32","index":30,"type":"Edge In Slot"},"31":{"name":"F2L 31","index":31,"type":"Edge In Slot"},"32":{"name":"F2L 33","index":32,"type":"Edge In Slot"},"33":{"name":"F2L 35","index":33,"type":"Edge In Slot"},"34":{"name":"F2L 34","index":34,"type":"Edge In Slot"},"35":{"name":"F2L 36","index":35,"type":"Edge In Slot"},"36":{"name":"AF2L 22","index":36,"type":"Trapped Edge"},"37":{"name":"AF2L 13","index":37,"type":"Trapped Edge"},"38":{"name":"AF2L 10","index":38,"type":"Trapped Edge"},"39":{"name":"AF2L 16","index":39,"type":"Trapped Edge"},"40":{"name":"AF2L 45","index":40,"type":"Trapped Edge"},"41":{"name":"AF2L 19","index":41,"type":"Trapped Edge"},"42":{"name":"AF2L 14","index":42,"type":"Trapped Edge"},"43":{"name":"AF2L 23","index":43,"type":"Trapped Edge"},"44":{"name":"AF2L 11","index":44,"type":"Trapped Edge"},"45":{"name":"AF2L 17","index":45,"type":"Trapped Edge"},"46":{"name":"AF2L 20","index":46,"type":"Trapped Edge"},"47":{"name":"AF2L 44","index":47,"type":"Trapped Edge"},"72":{"name":"AF2L 9","index":48,"type":"Trapped Corner"},"73":{"name":"AF2L 9a","index":49,"type":"Trapped Corner"},"74":{"name":"AF2L 6","index":50,"type":"Trapped Corner"},"75":{"name":"AF2L 6a","index":51,"type":"Trapped Corner"},"76":{"name":"AF2L 3","index":52,"type":"Trapped Corner"},"77":{"name":"AF2L 3a","index":53,"type":"Trapped Corner"},"78":{"name":"F2L 25","index":54,"type":"Corner In Slot"},"79":{"name":"F2L 26","index":55,"type":"Corner In Slot"},"80":{"name":"F2L 30","index":56,"type":"Corner In Slot"},"81":{"name":"F2L 28","index":57,"type":"Corner In Slot"},"82":{"name":"F2L 27","index":58,"type":"Corner In Slot"},"83":{"name":"F2L 29","index":59,"type":"Corner In Slot"},"84":{"name":"AF2L 7","index":60,"type":"Trapped Corner"},"85":{"name":"AF2L 7a","index":61,"type":"Trapped Corner"},"86":{"name":"AF2L 4","index":62,"type":"Trapped Corner"},"87":{"name":"AF2L 4a","index":63,"type":"Trapped Corner"},"88":{"name":"AF2L 1","index":64,"type":"Trapped Corner"},"89":{"name":"AF2L 1a","index":65,"type":"Trapped Corner"},"90":{"name":"AF2L 8","index":66,"type":"Trapped Corner"},"91":{"name":"AF2L 8a","index":67,"type":"Trapped Corner"},"92":{"name":"AF2L 5","index":68,"type":"Trapped Corner"},"93":{"name":"AF2L 5a","index":69,"type":"Trapped Corner"},"94":{"name":"AF2L 2","index":70,"type":"Trapped Corner"},"95":{"name":"AF2L 2a","index":71,"type":"Trapped Corner"},"96":{"name":"AF2L 42","index":72,"type":"Both Pieces Trapped"},"97":{"name":"AF2L 27","index":73,"type":"Both Pieces Trapped"},"98":{"name":"AF2L 33","index":74,"type":"Both Pieces Trapped"},"99":{"name":"AF2L 39","index":75,"type":"Both Pieces Trapped"},"100":{"name":"AF2L 30","index":76,"type":"Both Pieces Trapped"},"101":{"name":"AF2L 36","index":77,"type":"Both Pieces Trapped"},"151":{"name":"F2L 37","index":103,"type":"Pieces In Slot"},"152":{"name":"F2L 39","index":104,"type":"Pieces In Slot"},"153":{"name":"F2L 41","index":105,"type":"Pieces In Slot"},"154":{"name":"F2L 38","index":106,"type":"Pieces In Slot"},"155":{"name":"F2L 40","index":107,"type":"Pieces In Slot"},"204":{"name":"AF2L 40","index":132,"type":"Both Pieces Trapped"},"205":{"name":"AF2L 25","index":133,"type":"Both Pieces Trapped"},"206":{"name":"AF2L 31","index":134,"type":"Both Pieces Trapped"},"207":{"name":"AF2L 37","index":135,"type":"Both Pieces Trapped"},"208":{"name":"AF2L 28","index":136,"type":"Both Pieces Trapped"},"209":{"name":"AF2L 34","index":137,"type":"Both Pieces Trapped"},"258":{"name":"AF2L 26","index":162,"type":"Both Pieces Trapped"},"259":{"name":"AF2L 41","index":163,"type":"Both Pieces Trapped"},"260":{"name":"AF2L 38","index":164,"type":"Both Pieces Trapped"},"261":{"name":"AF2L 32","index":165,"type":"Both Pieces Trapped"},"262":{"name":"AF2L 35","index":166,"type":"Both Pieces Trapped"},"263":{"name":"AF2L 29","index":167,"type":"Both Pieces Trapped"}},"CMLL":{"1":{"name":"O Adjacent","index":0,"type":"O"},"2":{"name":"O Adjacent","index":0,"type":"O"},"3":{"name":"O Adjacent","index":0,"type":"O"},"4":{"name":"O Adjacent","index":0,"type":"O"},"5":{"name":"O Diagonal","index":1,"type":"O"},"24":{"name":"T Rows","index":20,"type":"T"},"25":{"name":"T Left Bar","index":18,"type":"T"},"26":{"name":"T Top Row","index":22,"type":"T"},"27":{"name":"T Bottom Row","index":21,"type":"T"},"28":{"name":"T Right Bar","index":19,"type":"T"},"29":{"name":"T Columns","index":23,"type":"T"},"48":{"name":"U Bottom Row","index":14,"type":"U"},"49":{"name":"U Down Slash","index":13,"type":"U"},"50":{"name":"U X","index":16,"type":"U"},"51":{"name":"U Rows","index":15,"type":"U"},"52":{"name":"U Up Slash","index":12,"type":"U"},"53":{"name":"U Upper Row","index":17,"type":"U"},"72":{"name":"L Pure","index":38,"type":"L"},"73":{"name":"L Best","index":36,"type":"L"},"74":{"name":"L Good","index":37,"type":"L"},"75":{"name":"L Back Commutator","index":41,"type":"L"},"76":{"name":"L Front Commutator","index":39,"type":"L"},"77":{"name":"L Diagonal","index":40,"type":"L"},"96":{"name":"Sune Left Bar","index":24,"type":"Sune"},"97":{"name":"Sune Down Slash","index":29,"type":"Sune"},"98":{"name":"Sune Columns","index":27,"type":"Sune"},"99":{"name":"Sune X","index":25,"type":"Sune"},"100":{"name":"Sune Up Slash","index":26,"type":"Sune"},"101":{"name":"Sune Right Bar","index":28,"type":"Sune"},"120":{"name":"T Rows","index":20,"type":"T"},"121":{"name":"T Top Row","index":22,"type":"T"},"122":{"name":"T Right Bar","index":19,"type":"T"},"123":{"name":"T Left Bar","index":18,"type":"T"},"124":{"name":"T Bottom Row","index":21,"type":"T"},"125":{"name":"T Columns","index":23,"type":"T"},"144":{"name":"L Pure","index":38,"type":"L"},"145":{"name":"L Front Commutator","index":39,"type":"L"},"146":{"name":"L Back Commutator","index":41,"type":"L"},"147":{"name":"L Good","index":37,"type":"L"},"148":{"name":"L Best","index":36,"type":"L"},"149":{"name":"L Diagonal","index":40,"type":"L"},"168":{"name":"U Bottom Row","index":14,"type":"U"},"169":{"name":"U X","index":16,"type":"U"},"170":{"name":"U Up Slash","index":12,"type":"U"},"171":{"name":"U Down Slash","index":13,"type":"U"},"172":{"name":"U Rows","index":15,"type":"U"},"173":{"name":"U Upper Row","index":17,"type":"U"},"192":{"name":"Anti Sune Right Bar","index":30,"type":"Anti Sune"},"193":{"name":"Anti Sune Columns","index":31,"type":"Anti Sune"},"194":{"name":"Anti Sune Up Slash","index":34,"type":"Anti Sune"},"195":{"name":"Anti Sune Down Slash","index":32,"type":"Anti Sune"},"196":{"name":"Anti Sune X","index":33,"type":"Anti Sune"},"197":{"name":"Anti Sune Left Bar","index":35,"type":"Anti Sune"},"216":{"name":"U Bottom Row","index":14,"type":"U"},"217":{"name":"U Rows","index":15,"type":"U"},"218":{"name":"U Down Slash","index":13,"type":"U"},"219":{"name":"U Up Slash","index":12,"type":"U"},"220":{"name":"U X","index":16,"type":"U"},"221":{"name":"U Upper Row","index":17,"type":"U"},"240":{"name":"Sune Left Bar","index":24,"type":"Sune"},"241":{"name":"Sune X","index":25,"type":"Sune"},"242":{"name":"Sune Down Slash","index":29,"type":"Sune"},"243":{"name":"Sune Up Slash","index":26,"type":"Sune"},"244":{"name":"Sune Columns","index":27,"type":"Sune"},"245":{"name":"Sune Right Bar","index":28,"type":"Sune"},"264":{"name":"L Pure","index":38,"type":"L"},"265":{"name":"L Good","index":37,"type":"L"},"266":{"name":"L Front Commutator","index":39,"type":"L"},"267":{"name":"L Best","index":36,"type":"L"},"268":{"name":"L Back Commutator","index":41,"type":"L"},"269":{"name":"L Diagonal","index":40,"type":"L"},"288":{"name":"Sune Left Bar","index":24,"type":"Sune"},"289":{"name":"Sune Up Slash","index":26,"type":"Sune"},"290":{"name":"Sune X","index":25,"type":"Sune"},"291":{"name":"Sune Columns","index":27,"type":"Sune"},"292":{"name":"Sune Down Slash","index":29,"type":"Sune"},"293":{"name":"Sune Right Bar","index":28,"type":"Sune"},"312":{"name":"Sune Left Bar","index":24,"type":"Sune"},"313":{"name":"Sune Columns","index":27,"type":"Sune"},"314":{"name":"Sune Up Slash","index":26,"type":"Sune"},"315":{"name":"Sune Down Slash","index":29,"type":"Sune"},"316":{"name":"Sune X","index":25,"type":"Sune"},"317":{"name":"Sune Right Bar","index":28,"type":"Sune"},"336":{"name":"Pi Right Bar","index":6,"type":"Pi"},"337":{"name":"Pi Columns","index":10,"type":"Pi"},"338":{"name":"Pi Up Slash","index":9,"type":"Pi"},"339":{"name":"Pi Down Slash","index":7,"type":"Pi"},"340":{"name":"Pi X","index":8,"type":"Pi"},"341":{"name":"Pi Left Bar","index":11,"type":"Pi"},"360":{"name":"T Rows","index":20,"type":"T"},"361":{"name":"T Right Bar","index":19,"type":"T"},"362":{"name":"T Bottom Row","index":21,"type":"T"},"363":{"name":"T Top Row","index":22,"type":"T"},"364":{"name":"T Left Bar","index":18,"type":"T"},"365":{"name":"T Columns","index":23,"type":"T"},"384":{"name":"H Columns","index":2,"type":"H"},"385":{"name":"H Row","index":5,"type":"H"},"386":{"name":"H Column","index":4,"type":"H"},"387":{"name":"H Column","index":4,"type":"H"},"388":{"name":"H Row","index":5,"type":"H"},"389":{"name":"H Rows","index":3,"type":"H"},"408":{"name":"Pi Right Bar","index":6,"type":"Pi"},"409":{"name":"Pi Up Slash","index":9,"type":"Pi"},"410":{"name":"Pi X","index":8,"type":"Pi"},"411":{"name":"Pi Columns","index":10,"type":"Pi"},"412":{"name":"Pi Down Slash","index":7,"type":"Pi"},"413":{"name":"Pi Left Bar","index":11,"type":"Pi"},"432":{"name":"T Rows","index":20,"type":"T"},"433":{"name":"T Bottom Row","index":21,"type":"T"},"434":{"name":"T Left Bar","index":18,"type":"T"},"435":{"name":"T Right Bar","index":19,"type":"T"},"436":{"name":"T Top Row","index":22,"type":"T"},"437":{"name":"T Columns","index":23,"type":"T"},"456":{"name":"L Pure","index":38,"type":"L"},"457":{"name":"L Back Commutator","index":41,"type":"L"},"458":{"name":"L Best","index":36,"type":"L"},"459":{"name":"L Front Commutator","index":39,"type":"L"},"460":{"name":"L Good","index":37,"type":"L"},"461":{"name":"L Diagonal","index":40,"type":"L"},"480":{"name":"Anti Sune Right Bar","index":30,"type":"Anti Sune"},"481":{"name":"Anti Sune Down Slash","index":32,"type":"Anti Sune"},"482":{"name":"Anti Sune Columns","index":31,"type":"Anti Sune"},"483":{"name":"Anti Sune X","index":33,"type":"Anti Sune"},"484":{"name":"Anti Sune Up Slash","index":34,"type":"Anti Sune"},"485":{"name":"Anti Sune Left Bar","index":35,"type":"Anti Sune"},"504":{"name":"U Bottom Row","index":14,"type":"U"},"505":{"name":"U Up Slash","index":12,"type":"U"},"506":{"name":"U Rows","index":15,"type":"U"},"507":{"name":"U X","index":16,"type":"U"},"508":{"name":"U Down Slash","index":13,"type":"U"},"509":{"name":"U Upper Row","index":17,"type":"U"},"528":{"name":"Pi Right Bar","index":6,"type":"Pi"},"529":{"name":"Pi Down Slash","index":7,"type":"Pi"},"530":{"name":"Pi Columns","index":10,"type":"Pi"},"531":{"name":"Pi X","index":8,"type":"Pi"},"532":{"name":"Pi Up Slash","index":9,"type":"Pi"},"533":{"name":"Pi Left Bar","index":11,"type":"Pi"},"552":{"name":"H Columns","index":2,"type":"H"},"553":{"name":"H Column","index":4,"type":"H"},"554":{"name":"H Row","index":5,"type":"H"},"555":{"name":"H Row","index":5,"type":"H"},"556":{"name":"H Column","index":4,"type":"H"},"557":{"name":"H Rows","index":3,"type":"H"},"576":{"name":"Anti Sune Right Bar","index":30,"type":"Anti Sune"},"577":{"name":"Anti Sune X","index":33,"type":"Anti Sune"},"578":{"name":"Anti Sune Down Slash","index":32,"type":"Anti Sune"},"579":{"name":"Anti Sune Up Slash","index":34,"type":"Anti Sune"},"580":{"name":"Anti Sune Columns","index":31,"type":"Anti Sune"},"581":{"name":"Anti Sune Left Bar","index":35,"type":"Anti Sune"},"600":{"name":"Pi Right Bar","index":6,"type":"Pi"},"601":{"name":"Pi X","index":8,"type":"Pi"},"602":{"name":"Pi Down Slash","index":7,"type":"Pi"},"603":{"name":"Pi Up Slash","index":9,"type":"Pi"},"604":{"name":"Pi Columns","index":10,"type":"Pi"},"605":{"name":"Pi Left Bar","index":11,"type":"Pi"},"624":{"name":"Anti Sune Right Bar","index":30,"type":"Anti Sune"},"625":{"name":"Anti Sune Up Slash","index":34,"type":"Anti Sune"},"626":{"name":"Anti Sune X","index":33,"type":"Anti Sune"},"627":{"name":"Anti Sune Columns","index":31,"type":"Anti Sune"},"628":{"name":"Anti Sune Down Slash","index":32,"type":"Anti Sune"},"629":{"name":"Anti Sune Left Bar","index":35,"type":"Anti Sune"}}};

  const FACE_MOVE_RE = /^[URFDLB](?:2|')?$/;
  const ROTATION_RE = /^[xyz](?:2|')?$/i;

  function available() {
    return !!(window.mathlib && window.mathlib.CubieCube);
  }

  function cloneCube(cube) {
    return new window.mathlib.CubieCube().init(cube.ca, cube.ea);
  }

  function parseFacelet(facelet) {
    if (!available()) return null;
    const text = String(facelet || '').trim().toUpperCase();
    if (text.length !== 54) return null;
    try {
      const cube = new window.mathlib.CubieCube();
      if (cube.fromFacelet(text) === -1 || cube.verify() !== 0) return null;
      return cube;
    } catch (_) {
      return null;
    }
  }

  function rebuildStates(startFacelet, moves) {
    const start = parseFacelet(startFacelet);
    if (!start) return [];
    const states = [start];
    let cube = cloneCube(start);
    for (const raw of (moves || [])) {
      const move = String(raw || '').trim();
      // mathlib.CubieCube only gives us a trustworthy reconstruction for face turns.
      // Slice / rotation solves must use hardware facelet snapshots instead of inventing state.
      if (!FACE_MOVE_RE.test(move)) return [];
      try {
        cube.selfMoveStr(move);
        states.push(cloneCube(cube));
      } catch (_) {
        return [];
      }
    }
    return states;
  }

  function statesFromSnapshots(startFacelet, moves, snapshots, rawSequence) {
    const n = (moves || []).length;
    const direct = [];
    if (Array.isArray(snapshots)) {
      for (const s of snapshots) {
        const cube = parseFacelet(typeof s === 'string' ? s : s && s.facelet);
        if (cube) direct.push(cube);
      }
    }
    if (direct.length === n + 1) return direct;

    // Some imported records keep the first state separately and one facelet per logical move.
    const start = parseFacelet(startFacelet);
    if (start && Array.isArray(rawSequence) && rawSequence.length === n) {
      const seq = [start];
      let complete = true;
      for (const item of rawSequence) {
        const cube = parseFacelet(item && item.facelet);
        if (!cube) { complete = false; break; }
        seq.push(cube);
      }
      if (complete) return seq;
    }
    return rebuildStates(startFacelet, moves);
  }

  function rotatedStates(states, rotation) {
    return states.map(src => {
      const cube = cloneCube(src);
      if (rotation) cube.selfConj(rotation);
      return cube;
    });
  }

  const edgePiece = (c, i) => c.ea[i] >> 1;
  const edgeOri = (c, i) => c.ea[i] & 1;
  const cornerPiece = (c, i) => c.ca[i] & 7;
  const cornerOri = (c, i) => c.ca[i] >> 3;
  const edgeSolved = (c, i) => c.ea[i] === i * 2;
  const cornerSolved = (c, i) => c.ca[i] === i;
  const all = (ids, fn) => ids.every(fn);

  function isSolved(c) {
    for (let i = 0; i < 8; i++) if (!cornerSolved(c, i)) return false;
    for (let i = 0; i < 12; i++) if (!edgeSolved(c, i)) return false;
    return true;
  }

  function cross(c) {
    return all([4, 5, 6, 7], i => edgeSolved(c, i));
  }

  function slotSolved(c, slot) {
    return cornerSolved(c, 4 + slot) && edgeSolved(c, 8 + slot);
  }

  function f2l(c) {
    return cross(c) && [0, 1, 2, 3].every(s => slotSolved(c, s));
  }

  function oll(c) {
    if (!f2l(c)) return false;
    return all([0, 1, 2, 3], i => cornerOri(c, i) === 0) &&
      all([0, 1, 2, 3], i => edgeOri(c, i) === 0);
  }

  function allEdgesOriented(c) {
    for (let i = 0; i < 12; i++) if (edgeOri(c, i) !== 0) return false;
    return true;
  }

  function eoCross(c) {
    return cross(c) && allEdgesOriented(c);
  }

  // Canonical Roux orientation: D-layer left block = DLF/DBL + DL/FL/BL.
  function firstBlock(c) {
    return all([5, 6], i => cornerSolved(c, i)) && all([6, 9, 10], i => edgeSolved(c, i));
  }

  function secondBlock(c) {
    return firstBlock(c) &&
      all([4, 7], i => cornerSolved(c, i)) && all([4, 8, 11], i => edgeSolved(c, i));
  }

  function topCornersSolvedUpToAUF(c) {
    if (!all([0, 1, 2, 3], i => cornerOri(c, i) === 0)) return false;
    const ids = [0, 1, 2, 3].map(i => cornerPiece(c, i));
    if (ids.some(x => x > 3)) return false;
    for (let shift = 0; shift < 4; shift++) {
      let ok = true;
      for (let i = 0; i < 4; i++) if (ids[i] !== (i + shift) % 4) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  function cmll(c) {
    return secondBlock(c) && topCornersSolvedUpToAUF(c);
  }

  function earliestStable(states, predicate, from = 0, through = states.length - 1) {
    let earliest = -1;
    let stable = true;
    for (let i = through; i >= from; i--) {
      stable = stable && !!predicate(states[i]);
      if (stable) earliest = i;
    }
    return earliest;
  }

  function confirmF2LSlots(states, crossIndex, f2lEnd) {
    const confirmed = new Set();
    const events = [];
    for (let i = crossIndex; i <= f2lEnd; i++) {
      const c = states[i];
      if (!cross(c)) continue;
      let priorStillSolved = true;
      for (const slot of confirmed) if (!slotSolved(c, slot)) { priorStillSolved = false; break; }
      if (!priorStillSolved) continue;
      const newly = [];
      for (let slot = 0; slot < 4; slot++) {
        if (!confirmed.has(slot) && slotSolved(c, slot)) newly.push(slot);
      }
      for (const slot of newly) {
        confirmed.add(slot);
        events.push({ slot, index: i });
      }
      if (confirmed.size === 4) break;
    }
    if (confirmed.size !== 4) return null;
    const last = events.reduce((m, e) => Math.max(m, e.index), crossIndex);
    if (last !== f2lEnd) return null;
    return events;
  }

  function detectCFOP(states) {
    const n = states.length - 1;
    if (n < 2 || !isSolved(states[n])) return null;

    // F2L is an invariant once CFOP reaches LL. Crucially: final solved state alone
    // is NOT enough evidence; this blocks the old "whole solve is Cross + 0s PLL" failure.
    const f2lEnd = earliestStable(states, f2l, 0, n);
    if (f2lEnd < 0 || f2lEnd >= n) return null;

    let chosen = null;
    for (let cr = 0; cr <= f2lEnd; cr++) {
      if (!cross(states[cr])) continue;
      const slots = confirmF2LSlots(states, cr, f2lEnd);
      if (!slots) continue;
      chosen = { cross: cr, slots };
      break;
    }
    if (!chosen) return null;

    const ollEnd = earliestStable(states, oll, f2lEnd, n);
    if (ollEnd < f2lEnd) return null;
    return {
      marks: [chosen.cross, f2lEnd, ollEnd, n],
      slotEvents: chosen.slots,
      confidence: 'detected'
    };
  }

  function detectRoux(states) {
    const n = states.length - 1;
    if (n < 2 || !isSolved(states[n])) return null;
    const sb = earliestStable(states, secondBlock, 0, n);
    if (sb < 0 || sb >= n) return null;
    const fb = earliestStable(states, firstBlock, 0, sb);
    if (fb < 0 || fb > sb) return null;
    const cm = earliestStable(states, cmll, sb, n);
    if (cm < sb) return null;
    return { marks: [fb, sb, cm, n], confidence: 'detected' };
  }

  function detectZZ(states) {
    const n = states.length - 1;
    if (n < 2 || !isSolved(states[n])) return null;
    const f = earliestStable(states, f2l, 0, n);
    if (f < 0 || f >= n) return null;
    const eo = earliestStable(states, eoCross, 0, f);
    if (eo < 0 || eo > f) return null;
    return { marks: [eo, f, n], confidence: 'detected' };
  }

  function detectForOrientation(method, states) {
    if (method === 'Roux') return detectRoux(states);
    if (method === 'ZZ') return detectZZ(states);
    return detectCFOP(states);
  }

  function candidateScore(method, result, n) {
    const m = result.marks;
    // Prefer an orientation that reaches the method's defining mid-stage earlier,
    // while still requiring all hard predicates. Tie-break on the first stage.
    if (method === 'Roux') return m[1] * 10000 + m[0] * 100 + m[2];
    if (method === 'ZZ') return m[1] * 10000 + m[0] * 100 + (n - m[1]);
    return m[1] * 10000 + m[0] * 100 + m[2];
  }

  function detect(method, baseStates) {
    const candidates = [];
    for (let rotation = 0; rotation < 24; rotation++) {
      const states = rotatedStates(baseStates, rotation);
      const result = detectForOrientation(method, states);
      if (!result) continue;
      candidates.push({
        rotation,
        states,
        ...result,
        score: candidateScore(method, result, states.length - 1)
      });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.score - b.score || a.rotation - b.rotation);
    const best = candidates[0];
    best.candidateCount = candidates.length;
    return best;
  }

  function moveTime(index, timestamps) {
    if (index <= 0) return 0;
    const t = Number(timestamps[index - 1]);
    return Number.isFinite(t) ? Math.max(0, t) : 0;
  }

  function countTurns(moves, start, end) {
    let count = 0;
    for (let i = start; i < end; i++) {
      const m = String(moves[i] || '').trim();
      if (m && !ROTATION_RE.test(m)) count++;
    }
    return count;
  }

  function stageTiming(startIndex, endIndex, moves, timestamps, options = {}) {
    const start = moveTime(startIndex, timestamps),end=moveTime(endIndex,timestamps);
    const time=Math.max(0,end-start);
    let recognition=0;
    if(!options.noRecognition && endIndex>startIndex){
      // Based on the original move-sequence semantics: a slow probe that is later
      // undone belongs to recognition; a continuous (<400ms) or non-undo turn
      // begins execution. Rotations are not physical turns for this measurement.
      const segment=moves.slice(startIndex,endIndex);
      const times=timestamps.slice(startIndex,endIndex).map(Number);
      let executionIndex=-1;
      for(let i=0;i<segment.length;i++){
        const m=String(segment[i]||'').trim();
        if(ROTATION_RE.test(m))continue;
        const face=m[0],power=m.endsWith('2')?2:m.endsWith("'")?3:1;
        let net=power;
        for(let j=i+1;j<segment.length;j++)if(String(segment[j]||'').trim()[0]===face){const x=String(segment[j]);net=(net+(x.endsWith('2')?2:x.endsWith("'")?3:1))%4;}
        const undone=net%4===0,fast=i<segment.length-1&&times[i+1]-times[i]<=PAUSE_MS;
        if(!undone||fast){executionIndex=i;break}
      }
      if(executionIndex<0)executionIndex=segment.length-1;
      recognition=Math.max(0,Math.min(time,times[executionIndex]-start));
    }
    return {time,turns:countTurns(moves,startIndex,endIndex),recognition,execution:Math.max(0,time-recognition),startIndex,endIndex,moves:moves.slice(startIndex,endIndex)};
  }

  function permParity(p) {
    let inv = 0;
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) inv++;
    return inv & 1;
  }

  function cmpTuple(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  }

  function canonOLL(co, eo) {
    let best = null;
    for (let shift = 0; shift < 4; shift++) {
      const v = [];
      for (let i = 0; i < 4; i++) v.push(co[(i + shift) % 4]);
      for (let i = 0; i < 4; i++) v.push(eo[(i + shift) % 4]);
      if (!best || cmpTuple(v, best) < 0) best = v;
    }
    return best.join('');
  }

  function buildOLLClasses() {
    const set = new Set();
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) for (let d = 0; d < 3; d++) {
      const co = [a, b, c, d];
      if ((a + b + c + d) % 3) continue;
      for (let mask = 0; mask < 16; mask++) {
        const eo = [0, 1, 2, 3].map(i => (mask >> i) & 1);
        if ((eo[0] + eo[1] + eo[2] + eo[3]) % 2) continue;
        set.add(canonOLL(co, eo));
      }
    }
    const solved = canonOLL([0, 0, 0, 0], [0, 0, 0, 0]);
    return [...set].filter(x => x !== solved).sort();
  }

  function canonPLL(cp, ep) {
    let best = null;
    for (let posShift = 0; posShift < 4; posShift++) {
      for (let pieceShift = 0; pieceShift < 4; pieceShift++) {
        const v = [];
        for (let i = 0; i < 4; i++) v.push((cp[(i + posShift) % 4] - pieceShift + 4) % 4);
        for (let i = 0; i < 4; i++) v.push((ep[(i + posShift) % 4] - pieceShift + 4) % 4);
        if (!best || cmpTuple(v, best) < 0) best = v;
      }
    }
    return best.join('');
  }

  function permutations4() {
    const out = [];
    const rec = (arr, used) => {
      if (arr.length === 4) { out.push(arr.slice()); return; }
      for (let i = 0; i < 4; i++) if (!used[i]) { used[i] = true; arr.push(i); rec(arr, used); arr.pop(); used[i] = false; }
    };
    rec([], [false, false, false, false]);
    return out;
  }

  function buildPLLClasses() {
    const perms = permutations4();
    const set = new Set();
    for (const cp of perms) for (const ep of perms) if (permParity(cp) === permParity(ep)) set.add(canonPLL(cp, ep));
    const solved = canonPLL([0, 1, 2, 3], [0, 1, 2, 3]);
    return [...set].filter(x => x !== solved).sort();
  }

  function canonCMLL(cp, co) {
    let best = null;
    for (let posShift = 0; posShift < 4; posShift++) {
      for (let pieceShift = 0; pieceShift < 4; pieceShift++) {
        const v = [];
        for (let i = 0; i < 4; i++) v.push((cp[(i + posShift) % 4] - pieceShift + 4) % 4);
        for (let i = 0; i < 4; i++) v.push(co[(i + posShift) % 4]);
        if (!best || cmpTuple(v, best) < 0) best = v;
      }
    }
    return best.join('');
  }

  function buildCMLLClasses() {
    const perms = permutations4();
    const set = new Set();
    for (const cp of perms) {
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) for (let d = 0; d < 3; d++) {
        if ((a + b + c + d) % 3) continue;
        set.add(canonCMLL(cp, [a, b, c, d]));
      }
    }
    const solved = canonCMLL([0, 1, 2, 3], [0, 0, 0, 0]);
    return [...set].filter(x => x !== solved).sort();
  }

  const OLL_CLASSES = buildOLLClasses();
  const PLL_CLASSES = buildPLLClasses();
  const CMLL_CLASSES = buildCMLLClasses();

  // Source-compatible cstimer -> canonical case-rank conversion. cstimer corner
  // twist 1/2 has the reverse direction of the reference cubie convention.
  const C2A_CORNER = [1,2,3,0,5,6,7,4];
  const C2A_EDGE = [0,1,2,3,8,9,10,11,5,6,7,4];
  const A2C_CORNER = [3,0,1,2,7,4,5,6];
  const A2C_EDGE = [0,1,2,3,11,8,9,10,4,5,6,7];
  const TOP_C = [3,0,1,2], TOP_E = [3,0,1,2];
  const TOP_CP = TOP_C.map(x=>A2C_CORNER[x]), TOP_EP = TOP_E.map(x=>A2C_EDGE[x]);
  const D_CORNERS = [5,6,7,4], D_EDGES=[5,6,7,4];
  const ao = v => (3-(v%3))%3;
  function caseMatch(type,rank){
    const entry=STANDARD_CASES[type]?.[String(rank)];
    return entry?{caseType:type,caseIndex:entry.index,caseName:entry.name,caseGroup:entry.type,caseRank:rank}:null;
  }
  function lexRank4(arr){
    let ret=0;for(let i=0;i<arr.length-1;i++){let smaller=0;for(let j=i+1;j<arr.length;j++)if(arr[j]<arr[i])smaller++;ret+=smaller*[6,2,1][i]}return ret;
  }
  function rankOLL(c){
    if(!f2l(c))return null;
    let er=0,cr=0;for(let i=0;i<3;i++){er+=(c.ea[TOP_EP[i]]&1)*(1<<i);cr+=ao(c.ca[TOP_CP[i]]>>3)*Math.pow(3,i)}return 80*er+cr;
  }
  function rankPLL(c){
    if(!oll(c))return null;
    const cp=TOP_CP.map(i=>TOP_C.indexOf(C2A_CORNER[c.ca[i]&7]));
    const ep=TOP_EP.map(i=>TOP_E.indexOf(C2A_EDGE[c.ea[i]>>1]));
    if(cp.some(x=>x<0)||ep.some(x=>x<0))return null;
    const k=cp.indexOf(Math.min(...cp));for(let i=0;i<k;i++){cp.push(cp.shift());ep.push(ep.shift())}
    return lexRank4(cp)*24+lexRank4(ep);
  }
  function rankCMLL(c){
    const cp=TOP_CP.map(i=>TOP_C.indexOf(C2A_CORNER[c.ca[i]&7]));
    const co=TOP_CP.map(i=>ao(c.ca[i]>>3));if(cp.some(x=>x<0))return null;
    const k=cp.indexOf(Math.min(...cp));for(let i=0;i<k;i++){cp.push(cp.shift());co.push(co.shift())}
    return (co[0]+3*co[1]+9*co[2])*24+lexRank4(cp);
  }
  function rankF2L(c,slot){
    const targetCorner=D_CORNERS[slot],targetEdge=D_EDGES[slot];
    if(targetCorner==null||targetEdge==null)return null;
    let cp=-1,co=0,ep=-1,eo=0;
    for(let a=0;a<8;a++){const i=A2C_CORNER[a];if(C2A_CORNER[c.ca[i]&7]===targetCorner){cp=a;co=ao(c.ca[i]>>3);break}}
    for(let a=0;a<12;a++){const i=A2C_EDGE[a];if(C2A_EDGE[c.ea[i]>>1]===targetEdge){ep=a;eo=c.ea[i]&1;break}}
    if(cp<0||ep<0)return null;
    const offset=((targetCorner-D_CORNERS[0])%4+4)%4;
    const n=cp<=3?(cp-offset+4)%4:(cp-4-offset+4)%4+4;
    const r=ep<=3?(ep-offset+4)%4:ep<=7?(ep-4-offset+4)%4+4:(ep-8-offset+4)%4+8;
    if(TOP_E.includes(ep))eo^=offset%2;
    const ct=TOP_C.includes(cp),et=TOP_E.includes(ep);
    if(ct&&et)return ((TOP_E.indexOf(ep)-TOP_C.indexOf(cp)+4)%4)*6+co*2+eo;
    if(ct&&!et)return 24+6*[4,5,6,7,8,9,10,11].indexOf(r)+co*2+eo;
    if(!ct&&et)return 72+6*[4,5,6,7].indexOf(n)+co*2+eo;
    return 96+48*[4,5,6,7].indexOf(n)+6*[4,5,6,7,8,9,10,11].indexOf(r)+co*2+eo;
  }
  function ollCase(c){return caseMatch('OLL',rankOLL(c))}
  function pllCase(c){return caseMatch('PLL',rankPLL(c))}
  function cmllCase(c){return caseMatch('CMLL',rankCMLL(c))}
  function f2lPairCase(c,slot){return caseMatch('F2L',rankF2L(c,slot))}

  function attachCase(step, meta) {
    if (!step || !meta) return step;
    Object.assign(step, meta);
    return step;
  }

  function makeCFOPSteps(found, moves, timestamps) {
    const [cr, f2lEnd, ollEnd, n] = found.marks;
    const steps = [];
    steps.push({ name: 'Cross', label: 'Cross', ...stageTiming(0, cr, moves, timestamps, { noRecognition: true }) });

    const f2lAggregate = { name: 'F2L', label: 'F2L', ...stageTiming(cr, f2lEnd, moves, timestamps) };
    steps.push(f2lAggregate);

    let prev = cr;
    const slotEvents = found.slotEvents.slice().sort((a, b) => a.index - b.index || a.slot - b.slot);
    slotEvents.forEach((event, order) => {
      const st = { name: 'F2L', label: `F2L ${order + 1}`, slotIndex: order + 1, physicalSlot: event.slot, ...stageTiming(prev, event.index, moves, timestamps) };
      let meta=f2lPairCase(found.states[prev],event.slot);
      if(!meta){
        // Non-trainable intermediate pair ranks must not be displayed as a named Case.
        // Look forward only while Cross and earlier confirmed slots remain solved.
        const previousSlots=new Set(slotEvents.slice(0,order).map(x=>x.slot));
        for(let i=prev+1;i<=event.index&&!meta;i++){
          const state=found.states[i];
          if(!cross(state)||[...previousSlots].some(x=>!slotSolved(state,x)))continue;
          meta=f2lPairCase(state,event.slot);
        }
      }
      attachCase(st,meta);
      steps.push(st);
      prev=event.index;
    });

    const ollStep = { name: 'OLL', label: 'OLL', ...stageTiming(f2lEnd, ollEnd, moves, timestamps) };
    attachCase(ollStep, ollCase(found.states[f2lEnd]));
    steps.push(ollStep);

    const pllStep = { name: 'PLL', label: 'PLL', ...stageTiming(ollEnd, n, moves, timestamps) };
    attachCase(pllStep, pllCase(found.states[ollEnd]));
    steps.push(pllStep);
    return steps;
  }

  function makeRouxSteps(found, moves, timestamps) {
    const [fb, sb, cm, n] = found.marks;
    const out = [
      { name: 'FB', label: 'First Block', ...stageTiming(0, fb, moves, timestamps, { noRecognition: true }) },
      { name: 'SB', label: 'Second Block', ...stageTiming(fb, sb, moves, timestamps) },
      { name: 'CMLL', label: 'CMLL', ...stageTiming(sb, cm, moves, timestamps) },
      { name: 'LSE', label: 'LSE', ...stageTiming(cm, n, moves, timestamps) }
    ];
    attachCase(out[2], cmllCase(found.states[sb]));
    return out;
  }

  function makeZZSteps(found, moves, timestamps) {
    const [eo, f, n] = found.marks;
    return [
      { name: 'EOCross', label: 'EO Cross', ...stageTiming(0, eo, moves, timestamps, { noRecognition: true }) },
      { name: 'F2L', label: 'F2L', ...stageTiming(eo, f, moves, timestamps) },
      { name: 'ZBLL', label: 'ZBLL', ...stageTiming(f, n, moves, timestamps) }
    ];
  }

  function analyze({ method = 'CFOP', startFacelet, moves = [], timestamps = [], totalTime = 0, snapshots = [], rawSolutionSequence = [] } = {}) {
    if (!available() || !startFacelet || !Array.isArray(moves) || !moves.length) return null;
    const cleanMoves = moves.map(x => String(x || '').trim()).filter(Boolean);
    const cleanTs = (timestamps || []).map(Number);
    if (cleanMoves.length !== cleanTs.length || cleanTs.some(x => !Number.isFinite(x))) return null;

    const states = statesFromSnapshots(startFacelet, cleanMoves, snapshots, rawSolutionSequence);
    if (states.length !== cleanMoves.length + 1 || !isSolved(states[states.length - 1])) return null;

    const normalizedMethod = method === 'Roux' || method === 'ZZ' ? method : 'CFOP';
    const found = detect(normalizedMethod, states);
    if (!found) return null;

    const steps = normalizedMethod === 'CFOP'
      ? makeCFOPSteps(found, cleanMoves, cleanTs)
      : normalizedMethod === 'Roux'
        ? makeRouxSteps(found, cleanMoves, cleanTs)
        : makeZZSteps(found, cleanMoves, cleanTs);

    const lastMoveTime = cleanTs.length ? cleanTs[cleanTs.length - 1] : 0;
    return {
      analysisVersion: ANALYSIS_VERSION,
      method: normalizedMethod,
      rotation: found.rotation,
      steps,
      boundaries: found.marks.slice(),
      confidence: found.confidence || 'detected',
      postSolveReaction: Math.max(0, Number(totalTime || 0) - Number(lastMoveTime || 0)),
      frame: {
        autoDetected: true,
        colorNeutral: true,
        searchedOrientations: 24,
        validCandidates: found.candidateCount || 1,
        rotation: found.rotation,
        detector: 'state-track-v6',
        analysisVersion: ANALYSIS_VERSION
      }
    };
  }

  window.CubeAnalyzerSolveAnalysis = {
    ANALYSIS_VERSION,
    _test: {rankOLL,rankPLL,rankF2L,rankCMLL,caseMatch,detectCFOP,detectRoux,detectZZ},
    PAUSE_MS,
    analyze,
    parseFacelet,
    rebuildStates,
    statesFromSnapshots,
    _debug: { isSolved, cross, f2l, oll, firstBlock, secondBlock, cmll, eoCross, OLL_CLASSES, PLL_CLASSES, CMLL_CLASSES }
  };
})();
