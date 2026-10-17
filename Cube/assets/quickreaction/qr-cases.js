/* Quick Reaction 案例库（自动生成，勿手改）
 * 来源：Formula DB.txt 算法 + wiki 标准算法修正（OLL 3/4 标签互换、6/11/20/36/52 补齐、PLL Gb/Gd/Rb）
 * 每案经三重验证：A⁻¹(solved) 自解 + oracle 编号一致（保 F2L）+ 物理 facelet 正确（宽层转动 ori 已合并）
 * 共 57 OLL + 21 PLL = 78 案。bw=U 面 9 格黑白（1=U 色），side=侧带 12 格贴纸，sideU=侧带 U 贴纸位置
 */
window.QR_CASES = {
 "oll": [
  {
   "kind": "OLL",
   "id": "oll-1",
   "alg": "R U'2 R'2 F R F' U'2 R' F R F'",
   "facelet": "BLFBUFRRRUUURRRRRRFUBFFFFFFDDDDDDDDDUUULLLLLLLULBBBBBB",
   "bw": "000010000",
   "side": "FUBUUULULUUU",
   "sideU": "010111010111"
  },
  {
   "kind": "OLL",
   "id": "oll-2",
   "alg": "r U r' U'2 R U2 R' U'2 r U' r'",
   "facelet": "RLLBUFBRBUUFRRRRRRRULFFFFFFDDDDDDDDDFUULLLLLLUUUBBBBBB",
   "bw": "000010000",
   "side": "RULUUFUUUFUU",
   "sideU": "010110111011"
  },
  {
   "kind": "OLL",
   "id": "oll-3",
   "alg": "R' F2 R2 U'2 R' F R U'2 R'2 F2 R",
   "facelet": "ULFFUBRRLBUURRRRRRFUUFFFFFFDDDDDDDDDBUULLLLLLLURBBBBBB",
   "bw": "100010000",
   "side": "FUUBUULURBUU",
   "sideU": "011011010011"
  },
  {
   "kind": "OLL",
   "id": "oll-4",
   "alg": "R' F2 R2 U'2 R' F' R U'2 R'2 F2 R",
   "facelet": "FRUBUFRLLUUBRRRRRRUUFFFFFFFDDDDDDDDDUUBLLLLLLLURBBBBBB",
   "bw": "001010000",
   "side": "UUFUUBLURUUB",
   "sideU": "110110010110"
  },
  {
   "kind": "OLL",
   "id": "oll-5",
   "alg": "r' U'2 R U R' U r",
   "facelet": "RRFBUUBUULLURRRRRRRFBFFFFFFDDDDDDDDDFUULLLLLLLUUBBBBBB",
   "bw": "000011011",
   "side": "RFBLLULUUFUU",
   "sideU": "000001011011"
  },
  {
   "kind": "OLL",
   "id": "oll-6",
   "alg": "r U2 R' U' R U' r'",
   "facelet": "FUUFUURRBULLRRRRRRUULFFFFFFDDDDDDDDDUUBLLLLLLFBRBBBBBB",
   "bw": "011011000",
   "side": "UULULLFBRUUB",
   "sideU": "110100000110"
  },
  {
   "kind": "OLL",
   "id": "oll-7",
   "alg": "r U R' U R U'2 r'",
   "facelet": "RUFUUFULLBUURRRRRRBUUFFFFFFDDDDDDDDDFRRLLLLLLLBUBBBBBB",
   "bw": "010110100",
   "side": "BUUBUULBUFRR",
   "sideU": "011011001000"
  },
  {
   "kind": "OLL",
   "id": "oll-8",
   "alg": "r' U' R U' R' U'2 r",
   "facelet": "ULLUUBRUBUUFRRRRRRUFLFFFFFFDDDDDDDDDRRBLLLLLLUUFBBBBBB",
   "bw": "100110010",
   "side": "UFLUUFUUFRRB",
   "sideU": "100110110000"
  },
  {
   "kind": "OLL",
   "id": "oll-9",
   "alg": "R U R' U' R' F R2 U R' U' F'",
   "facelet": "FURUUFBBUFUBRRRRRRUULFFFFFFDDDDDDDDDULLLLLLLLURRBBBBBB",
   "bw": "010110001",
   "side": "UULFUBURRULL",
   "sideU": "110010100100"
  },
  {
   "kind": "OLL",
   "id": "oll-10",
   "alg": "R U R' U R' F R F' R U'2 R'",
   "facelet": "BBUUURRUFLUBRRRRRRFFUFFFFFFDDDDDDDDDRLULLLLLLLUUBBBBBB",
   "bw": "001110010",
   "side": "FFULUBLUURLU",
   "sideU": "001010011001"
  },
  {
   "kind": "OLL",
   "id": "oll-11",
   "alg": "r' R2 U R' U R U2 R' U M'",
   "facelet": "FLLBUUUUBRRURRRRRRRFUFFFFFFDDDDDDDDDLUFLLLLLLBUUBBBBBB",
   "bw": "000011110",
   "side": "RFURRUBUULUF",
   "sideU": "001001011010"
  },
  {
   "kind": "OLL",
   "id": "oll-12",
   "alg": "M' R' U' R U' R' U'2 R U' M",
   "facelet": "UUFFUUBLLURRRRRRRRUUFFFFFFFDDDDDDDDDBULLLLLLLUBRBBBBBB",
   "bw": "110011000",
   "side": "UUFURRUBRBUL",
   "sideU": "110100100010"
  },
  {
   "kind": "OLL",
   "id": "oll-13",
   "alg": "r U' r' U' r U r' F' U F",
   "facelet": "RFLUUUULBRRURRRRRRFUUFFFFFFDDDDDDDDDFBLLLLLLLBUUBBBBBB",
   "bw": "000111100",
   "side": "FUURRUBUUFBL",
   "sideU": "011001011000"
  },
  {
   "kind": "OLL",
   "id": "oll-14",
   "alg": "r U R' U' r' F R2 U R' U' F'",
   "facelet": "FFRUUUBRUFBBRRRRRRUULFFFFFFDDDDDDDDDULLLLLLLLUURBBBBBB",
   "bw": "000111001",
   "side": "UULFBBUURULL",
   "sideU": "110000110100"
  },
  {
   "kind": "OLL",
   "id": "oll-15",
   "alg": "r' U' r R' U' R U r' U r",
   "facelet": "RRFUUUBBULFURRRRRRRUBFFFFFFDDDDDDDDDFLULLLLLLLUUBBBBBB",
   "bw": "000111001",
   "side": "RUBLFULUUFLU",
   "sideU": "010001011001"
  },
  {
   "kind": "OLL",
   "id": "oll-16",
   "alg": "r U r' R U R' U' r U' r'",
   "facelet": "FFUUUURRBUBLRRRRRRUULFFFFFFDDDDDDDDDULBLLLLLLFURBBBBBB",
   "bw": "001111000",
   "side": "UULUBLFURULB",
   "sideU": "110100010100"
  },
  {
   "kind": "OLL",
   "id": "oll-17",
   "alg": "R U R' U R' F R F' U'2 R' F R F'",
   "facelet": "UBFFULFRULURRRRRRRLUBFFFFFFDDDDDDDDDBUULLLLLLUURBBBBBB",
   "bw": "100010001",
   "side": "LUBLURUURBUU",
   "sideU": "010010110011"
  },
  {
   "kind": "OLL",
   "id": "oll-18",
   "alg": "r U R' U R U'2 r'2 U' R U' R' U'2 r",
   "facelet": "ULUBUFLRRFURRRRRRRUUUFFFFFFDDDDDDDDDLUFLLLLLLBUBBBBBBB",
   "bw": "101010000",
   "side": "UUUFURBUBLUF",
   "sideU": "111010010010"
  },
  {
   "kind": "OLL",
   "id": "oll-19",
   "alg": "r' R U R U R' U' M' R' F R F'",
   "facelet": "ULUFUBFRRUUFRRRRRRLUBFFFFFFDDDDDDDDDLUULLLLLLRUBBBBBBB",
   "bw": "101010000",
   "side": "LUBUUFRUBLUU",
   "sideU": "010110010011"
  },
  {
   "kind": "OLL",
   "id": "oll-20",
   "alg": "r U R' U' r R' M' U R U' R' U' M'",
   "facelet": "URUBUFULUBUBRRRRRRRURFFFFFFDDDDDDDDDFUFLLLLLLLULBBBBBB",
   "bw": "101010101",
   "side": "RURBUBLULFUF",
   "sideU": "010010010010"
  },
  {
   "kind": "OLL",
   "id": "oll-21",
   "alg": "R U'2 R' U' R U R' U' R U' R'",
   "facelet": "LURUUULURFBBRRRRRRUFUFFFFFFDDDDDDDDDBRFLLLLLLULUBBBBBB",
   "bw": "010111010",
   "side": "UFUFBBULUBRF",
   "sideU": "101000101000"
  },
  {
   "kind": "OLL",
   "id": "oll-22",
   "alg": "R U'2 R'2 U' R2 U' R'2 U'2 R",
   "facelet": "FULUUUBULBRFRRRRRRRBUFFFFFFDDDDDDDDDUFULLLLLLULRBBBBBB",
   "bw": "010111010",
   "side": "RBUBRFULRUFU",
   "sideU": "001000100101"
  },
  {
   "kind": "OLL",
   "id": "oll-23",
   "alg": "R2 D' R U'2 R' D R U'2 R",
   "facelet": "RUBUUUUUUBRLRRRRRRFFRFFFFFFDDDDDDDDDFLLLLLLLLUBUBBBBBB",
   "bw": "010111111",
   "side": "FFRBRLUBUFLL",
   "sideU": "000000101000"
  },
  {
   "kind": "OLL",
   "id": "oll-24",
   "alg": "r U R' U' r' F R F'",
   "facelet": "FUUUUURUURRBRRRRRRUFFFFFFFFDDDDDDDDDLLBLLLLLLLBUBBBBBB",
   "bw": "011111011",
   "side": "UFFRRBLBULLB",
   "sideU": "100000001000"
  },
  {
   "kind": "OLL",
   "id": "oll-25",
   "alg": "F' r U R' U' r' F R",
   "facelet": "FUUUUUUUBRRBRRRRRRFFUFFFFFFDDDDDDDDDULLLLLLLLLBRBBBBBB",
   "bw": "011111110",
   "side": "FFURRBLBRULL",
   "sideU": "001000000100"
  },
  {
   "kind": "OLL",
   "id": "oll-26",
   "alg": "R U'2 R' U' R U' R'",
   "facelet": "FUUUUURUBULLRRRRRRUFLFFFFFFDDDDDDDDDUBBLLLLLLFRRBBBBBB",
   "bw": "011111010",
   "side": "UFLULLFRRUBB",
   "sideU": "100100000100"
  },
  {
   "kind": "OLL",
   "id": "oll-27",
   "alg": "R U R' U R U'2 R'",
   "facelet": "RUFUUUUULBBURRRRRRBFUFFFFFFDDDDDDDDDFRRLLLLLLLLUBBBBBB",
   "bw": "010111110",
   "side": "BFUBBULLUFRR",
   "sideU": "001001001000"
  },
  {
   "kind": "OLL",
   "id": "oll-28",
   "alg": "r U R' U' M U R U' R'",
   "facelet": "UUUUUFUBURURRRRRRRFUFFFFFFFDDDDDDDDDLLLLLLLLLBRBBBBBBB",
   "bw": "111110101",
   "side": "FUFRURBRBLLL",
   "sideU": "010010000000"
  },
  {
   "kind": "OLL",
   "id": "oll-29",
   "alg": "r'2 D' r U r' D r2 U' r' U' r",
   "facelet": "UBUUUFBUFUULRRRRRRRRRFFFFFFDDDDDDDDDLLULLLLLLFUBBBBBBB",
   "bw": "101110010",
   "side": "RRRUULFUBLLU",
   "sideU": "000110010001"
  },
  {
   "kind": "OLL",
   "id": "oll-30",
   "alg": "r2 D r' U' r D' r'2 U r U r'",
   "facelet": "FUBUUBUFULUURRRRRRFUBFFFFFFDDDDDDDDDULLLLLLLLRRRBBBBBB",
   "bw": "010110101",
   "side": "FUBLUURRRULL",
   "sideU": "010011000100"
  },
  {
   "kind": "OLL",
   "id": "oll-31",
   "alg": "R' U' F U R U' R' F' R",
   "facelet": "BUUBUULFURRBRRRRRRUUFFFFFFFDDDDDDDDDRUFLLLLLLLLUBBBBBB",
   "bw": "011011001",
   "side": "UUFRRBLLURUF",
   "sideU": "110000001010"
  },
  {
   "kind": "OLL",
   "id": "oll-32",
   "alg": "S R U R' U' R' F R f'",
   "facelet": "FFUBUURUURRBRRRRRRULFFFFFFFDDDDDDDDDLUBLLLLLLLUUBBBBBB",
   "bw": "001011011",
   "side": "ULFRRBLUULUB",
   "sideU": "100000011010"
  },
  {
   "kind": "OLL",
   "id": "oll-33",
   "alg": "R U R' U' R' F R F'",
   "facelet": "FFUUUURRURBBRRRRRRUUFFFFFFFDDDDDDDDDLLBLLLLLLLUUBBBBBB",
   "bw": "001111001",
   "side": "UUFRBBLUULLB",
   "sideU": "110000011000"
  },
  {
   "kind": "OLL",
   "id": "oll-34",
   "alg": "f R f' U' r' U' R U M'",
   "facelet": "RUURUBBUUFURRRRRRRUFLFFFFFFDDDDDDDDDFULLLLLLLBLUBBBBBB",
   "bw": "011010011",
   "side": "UFLFURBLUFUL",
   "sideU": "100010001010"
  },
  {
   "kind": "OLL",
   "id": "oll-35",
   "alg": "R U'2 R'2 F R F' R U'2 R'",
   "facelet": "URRBUUBUUBLURRRRRRUFRFFFFFFDDDDDDDDDFULLLLLLLFULBBBBBB",
   "bw": "100011011",
   "side": "UFRBLUFULFUL",
   "sideU": "100001010010"
  },
  {
   "kind": "OLL",
   "id": "oll-36",
   "alg": "L' U' L U' L' U L U L F' L' F",
   "facelet": "UULFUURLUBBFRRRRRRFURFFFFFFDDDDDDDDDLUULLLLLLURBBBBBBB",
   "bw": "110011001",
   "side": "FURBBFURBLUU",
   "sideU": "010000100011"
  },
  {
   "kind": "OLL",
   "id": "oll-37",
   "alg": "F R U' R' U' R U R' F'",
   "facelet": "UUFUUFBBUBUURRRRRRUURFFFFFFDDDDDDDDDRRLLLLLLLLLFBBBBBB",
   "bw": "110110001",
   "side": "UURBUULLFRRL",
   "sideU": "110011000000"
  },
  {
   "kind": "OLL",
   "id": "oll-38",
   "alg": "R U R' U R U' R' U' R' F R F'",
   "facelet": "RUUUUFURLUURRRRRRRLUFFFFFFFDDDDDDDDDFBBLLLLLLBLUBBBBBB",
   "bw": "011110100",
   "side": "LUFUURBLUFBB",
   "sideU": "010110001000"
  },
  {
   "kind": "OLL",
   "id": "oll-39",
   "alg": "f' r U r' U' r' F r S",
   "facelet": "FRUUUUUBBRFBRRRRRRFUUFFFFFFDDDDDDDDDULLLLLLLLLURBBBBBB",
   "bw": "001111100",
   "side": "FUURFBLURULL",
   "sideU": "011000010100"
  },
  {
   "kind": "OLL",
   "id": "oll-40",
   "alg": "f R' F' R U R U' R' S'",
   "facelet": "ULFUUUBBURRURRRRRRUUFFFFFFFDDDDDDDDDBFLLLLLLLLURBBBBBB",
   "bw": "100111001",
   "side": "UUFRRULURBFL",
   "sideU": "110001010000"
  },
  {
   "kind": "OLL",
   "id": "oll-41",
   "alg": "R U R' U R U'2 R' F R U R' U' F'",
   "facelet": "FUFUUFURUBURRRRRRRLURFFFFFFDDDDDDDDDLBBLLLLLLULUBBBBBB",
   "bw": "010110101",
   "side": "LURBURULULBB",
   "sideU": "010010101000"
  },
  {
   "kind": "OLL",
   "id": "oll-42",
   "alg": "R' U' R U' R' U'2 R F R U R' U' F'",
   "facelet": "UFUUURBUBRUFRRRRRRULUFFFFFFDDDDDDDDDFBLLLLLLLRULBBBBBB",
   "bw": "101110010",
   "side": "ULURUFRULFBL",
   "sideU": "101010010000"
  },
  {
   "kind": "OLL",
   "id": "oll-43",
   "alg": "B' U' R' U R B",
   "facelet": "UFLUUBUULUUURRRRRRRRFFFFFFFDDDDDDDDDBLFLLLLLLBURBBBBBB",
   "bw": "100110110",
   "side": "RRFUUUBURBLF",
   "sideU": "000111010000"
  },
  {
   "kind": "OLL",
   "id": "oll-44",
   "alg": "f R U R' U' f'",
   "facelet": "RFUBUURUUFRBRRRRRRFLLFFFFFFDDDDDDDDDUUULLLLLLLUBBBBBBB",
   "bw": "001011011",
   "side": "FLLFRBLUBUUU",
   "sideU": "000000010111"
  },
  {
   "kind": "OLL",
   "id": "oll-45",
   "alg": "F R U R' U' F'",
   "facelet": "RFUUUURRUFBBRRRRRRFULFFFFFFDDDDDDDDDULULLLLLLLUBBBBBBB",
   "bw": "001111001",
   "side": "FULFBBLUBULU",
   "sideU": "010000010101"
  },
  {
   "kind": "OLL",
   "id": "oll-46",
   "alg": "R' U' R' F R F' U R",
   "facelet": "UULFULUULUUURRRRRRRRFFFFFFFDDDDDDDDDBUFLLLLLLBBRBBBBBB",
   "bw": "110010110",
   "side": "RRFUUUBBRBUF",
   "sideU": "000111000010"
  },
  {
   "kind": "OLL",
   "id": "oll-47",
   "alg": "b' U' R' U R U' R' U R b",
   "facelet": "LUBFUULBFURURRRRRRUURFFFFFFDDDDDDDDDBUFLLLLLLRLUBBBBBB",
   "bw": "010011000",
   "side": "UURURURLUBUF",
   "sideU": "110101001010"
  },
  {
   "kind": "OLL",
   "id": "oll-48",
   "alg": "F R U R' U' R U R' U' F'",
   "facelet": "BURUUFFBRFUBRRRRRRLUUFFFFFFDDDDDDDDDULULLLLLLURLBBBBBB",
   "bw": "010110000",
   "side": "LUUFUBURLULU",
   "sideU": "011010100101"
  },
  {
   "kind": "OLL",
   "id": "oll-49",
   "alg": "R B' R'2 F R2 B R'2 F' R",
   "facelet": "RRFUUFRUBUUURRRRRRUBLFFFFFFDDDDDDDDDFLBLLLLLLLUUBBBBBB",
   "bw": "000110010",
   "side": "UBLUUULUUFLB",
   "sideU": "100111011000"
  },
  {
   "kind": "OLL",
   "id": "oll-50",
   "alg": "r' U r2 U' r'2 U' r2 U r'",
   "facelet": "FLLFUUBULBRFRRRRRRRBUFFFFFFDDDDDDDDDUUULLLLLLUURBBBBBB",
   "bw": "000011010",
   "side": "RBUBRFUURUUU",
   "sideU": "001000110111"
  },
  {
   "kind": "OLL",
   "id": "oll-51",
   "alg": "f R U R' U' R U R' U' f'",
   "facelet": "BLRUUUFBRFRBRRRRRRLUUFFFFFFDDDDDDDDDUFULLLLLLUULBBBBBB",
   "bw": "000111000",
   "side": "LUUFRBUULUFU",
   "sideU": "011000110101"
  },
  {
   "kind": "OLL",
   "id": "oll-52",
   "alg": "R U R' U R U' B U' B' R'",
   "facelet": "BULLURFULUUURRRRRRUFFFFFFFFDDDDDDDDDRURLLLLLLBBUBBBBBB",
   "bw": "010010010",
   "side": "UFFUUUBBURUR",
   "sideU": "100111001010"
  },
  {
   "kind": "OLL",
   "id": "oll-53",
   "alg": "r' U'2 R U R' U' R U R' U r",
   "facelet": "LLRUUBLURFUBRRRRRRUFUFFFFFFDDDDDDDDDBRFLLLLLLUUUBBBBBB",
   "bw": "000110010",
   "side": "UFUFUBUUUBRF",
   "sideU": "101010111000"
  },
  {
   "kind": "OLL",
   "id": "oll-54",
   "alg": "r U'2 R' U' R U R' U' R U' r'",
   "facelet": "LURUUFLLRFUBRRRRRRUUUFFFFFFDDDDDDDDDBRFLLLLLLUBUBBBBBB",
   "bw": "010110000",
   "side": "UUUFUBUBUBRF",
   "sideU": "111010101000"
  },
  {
   "kind": "OLL",
   "id": "oll-55",
   "alg": "r U'2 R' U' r' R2 U R' U' r U' r'",
   "facelet": "LFRUUULBRFLBRRRRRRUUUFFFFFFDDDDDDDDDBRFLLLLLLUUUBBBBBB",
   "bw": "000111000",
   "side": "UUUFLBUUUBRF",
   "sideU": "111000111000"
  },
  {
   "kind": "OLL",
   "id": "oll-56",
   "alg": "r U r' U R U' R' U R U' R' r U' r'",
   "facelet": "BFBUUUFRFUBURRRRRRLURFFFFFFDDDDDDDDDULULLLLLLRULBBBBBB",
   "bw": "000111000",
   "side": "LURUBURULULU",
   "sideU": "010101010101"
  },
  {
   "kind": "OLL",
   "id": "oll-57",
   "alg": "R U R' U' M' U R U' r'",
   "facelet": "UFUUUUURURBRRRRRRRFUFFFFFFFDDDDDDDDDLLLLLLLLLBUBBBBBBB",
   "bw": "101111101",
   "side": "FUFRBRBUBLLL",
   "sideU": "010000010000"
  }
 ],
 "pll": [
  {
   "kind": "PLL",
   "id": "pll-aa",
   "alg": "x R' U R' D2 R U' R' D2 R2 x'",
   "facelet": "UUUUUUUUULRFRRRRRRFFBFFFFFFDDDDDDDDDBLLLLLLLLRBRBBBBBB",
   "bw": "111111111",
   "side": "FFBLRFRBRBLL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-ab",
   "alg": "x R2 D2 R U R' D2 R U' R x'",
   "facelet": "UUUUUUUUUBRBRRRRRRFFRFFFFFFDDDDDDDDDRLLLLLLLLLBFBBBBBB",
   "bw": "111111111",
   "side": "FFRBRBLBFRLL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-e",
   "alg": "x' R U' R' D R U R' D' R U R' D R U' R' D' x",
   "facelet": "UUUUUUUUUBRFRRRRRRLFRFFFFFFDDDDDDDDDFLBLLLLLLRBLBBBBBB",
   "bw": "111111111",
   "side": "LFRBRFRBLFLB",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-f",
   "alg": "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R",
   "facelet": "UUUUUUUUUBRFRRRRRRFBRFFFFFFDDDDDDDDDLLLLLLLLLRFBBBBBBB",
   "bw": "111111111",
   "side": "FBRBRFRFBLLL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-ga",
   "alg": "R2 U R' U R' U' R U' R2 U' D R' U R D'",
   "facelet": "UUUUUUUUUBLFRRRRRRFRRFFFFFFDDDDDDDDDLBLLLLLLLRFBBBBBBB",
   "bw": "111111111",
   "side": "FRRBLFRFBLBL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-gb",
   "alg": "R' U' R U D' R2 U R' U R U' R U' R2 D",
   "facelet": "UUUUUUUUUBFFRRRRRRFBRFFFFFFDDDDDDDDDLRLLLLLLLRLBBBBBBB",
   "bw": "111111111",
   "side": "FBRBFFRLBLRL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-gc",
   "alg": "R2 U' R U' R U R' U R2 U D' R U' R' D",
   "facelet": "UUUUUUUUUBLFRRRRRRFBRFFFFFFDDDDDDDDDLFLLLLLLLRRBBBBBBB",
   "bw": "111111111",
   "side": "FBRBLFRRBLFL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-gd",
   "alg": "R U2 R' U B' R' U' R U R B U R' U' R' U R",
   "facelet": "UUUUUUUUUBFBRRRRRRFLRFFFFFFDDDDDDDDDRRLLLLLLLLBFBBBBBB",
   "bw": "111111111",
   "side": "FLRBFBLBFRRL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-h",
   "alg": "M2 U M2 U2 M2 U M2",
   "facelet": "UUUUUUUUURLRRRRRRRFBFFFFFFFDDDDDDDDDLRLLLLLLLBFBBBBBBB",
   "bw": "111111111",
   "side": "FBFRLRBFBLRL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-ja",
   "alg": "R' U L' U2 R U' R' U2 R L U'",
   "facelet": "UUUUUUUUURRBRRRRRRFFFFFFFFFDDDDDDDDDBBLLLLLLLLLRBBBBBB",
   "bw": "111111111",
   "side": "FFFRRBLLRBBL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-jb",
   "alg": "R U R' F' R U R' U' R' F R2 U' R'",
   "facelet": "UUUUUUUUURLLRRRRRRLFFFFFFFFDDDDDDDDDBBBLLLLLLFRRBBBBBB",
   "bw": "111111111",
   "side": "LFFRLLFRRBBB",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-na",
   "alg": "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'",
   "facelet": "UUUUUUUUURLLRRRRRRBFFFFFFFFDDDDDDDDDLRRLLLLLLFBBBBBBBB",
   "bw": "111111111",
   "side": "BFFRLLFBBLRR",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-nb",
   "alg": "R' U R U' R' F' U' F R U R' F R' F' R U' R",
   "facelet": "UUUUUUUUULLRRRRRRRFFBFFFFFFDDDDDDDDDRRLLLLLLLBBFBBBBBB",
   "bw": "111111111",
   "side": "FFBLLRBBFRRL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-ra",
   "alg": "R U' R' U' R U R D R' U' R D' R' U2 R'",
   "facelet": "UUUUUUUUURFLRRRRRRLLFFFFFFFDDDDDDDDDBRBLLLLLLFBRBBBBBB",
   "bw": "111111111",
   "side": "LLFRFLFBRBRB",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-rb",
   "alg": "R' U2 R U2 R' F R U R' U' R' F' R2 U'",
   "facelet": "UUUUUUUUURFBRRRRRRFRFFFFFFFDDDDDDDDDBLLLLLLLLLBRBBBBBB",
   "bw": "111111111",
   "side": "FRFRFBLBRBLL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-t",
   "alg": "R U R' U' R' F R2 U' R' U' R U R' F'",
   "facelet": "UUUUUUUUUBLFRRRRRRFFRFFFFFFDDDDDDDDDLRLLLLLLLRBBBBBBBB",
   "bw": "111111111",
   "side": "FFRBLFRBBLRL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-ua",
   "alg": "M2 U M U2 M' U M2",
   "facelet": "UUUUUUUUURLRRRRRRRFRFFFFFFFDDDDDDDDDLFLLLLLLLBBBBBBBBB",
   "bw": "111111111",
   "side": "FRFRLRBBBLFL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-ub",
   "alg": "M2 U' M U2 M' U' M2",
   "facelet": "UUUUUUUUURFRRRRRRRFLFFFFFFFDDDDDDDDDLRLLLLLLLBBBBBBBBB",
   "bw": "111111111",
   "side": "FLFRFRBBBLRL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-v",
   "alg": "R' U R' U' R D' R' D R' U D' R2 U' R2 D R2",
   "facelet": "UUUUUUUUULBRRRRRRRFFBFFFFFFDDDDDDDDDRLLLLLLLLBRFBBBBBB",
   "bw": "111111111",
   "side": "FFBLBRBRFRLL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-y",
   "alg": "F R U' R' U' R U R' F' R U R' U' R' F R F'",
   "facelet": "UUUUUUUUULRRRRRRRRFFBFFFFFFDDDDDDDDDRBLLLLLLLBLFBBBBBB",
   "bw": "111111111",
   "side": "FFBLRRBLFRBL",
   "sideU": "000000000000"
  },
  {
   "kind": "PLL",
   "id": "pll-z",
   "alg": "M2 U M2 U M' U2 M2 U2 M' U2",
   "facelet": "UUUUUUUUURFRRRRRRRFRFFFFFFFDDDDDDDDDLBLLLLLLLBLBBBBBBB",
   "bw": "111111111",
   "side": "FRFRFRBLBLBL",
   "sideU": "000000000000"
  }
 ]
};
