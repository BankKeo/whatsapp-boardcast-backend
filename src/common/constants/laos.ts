/**
 * Lao province / district reference data.
 *
 * Copied from the dashboard (`lib/data/constants.ts`) so both sides validate
 * against the same list. In production these become seed rows for the `Province`
 * collection (see src/modules/outlets/province.model.ts) so administrators can
 * extend them from Settings without a deploy.
 */

export type Region = "North" | "Central" | "South";

export interface ProvinceInfo {
  name: string;
  region: Region;
  districts: string[];
}

export const PROVINCES: ProvinceInfo[] = [
  {
    name: "Vientiane Capital",
    region: "Central",
    districts: [
      "Chanthabouly",
      "Sikhottabong",
      "Xaysetha",
      "Sisattanak",
      "Naxaithong",
      "Hadxaifong",
      "Sangthong",
      "Pak Ngum",
      "Mayparkngum",
    ],
  },
  {
    name: "Savannakhet",
    region: "South",
    districts: [
      "Kaysone Phomvihane",
      "Outhoumphone",
      "Atsaphangthong",
      "Phine",
      "Xephon",
      "Songkhone",
      "Champhone",
      "Thapangthong",
      "Nong",
      "Xayboury",
      "Vilaboury",
      "Phalanxay",
      "Sepone",
    ],
  },
  {
    name: "Champasack",
    region: "South",
    districts: [
      "Pakse",
      "Sanasomboun",
      "Batiengchaleunsouk",
      "Paksong",
      "Pathoumphon",
      "Phonthong",
      "Champasack",
      "Sukhuma",
      "Mounlapamok",
      "Khong",
    ],
  },
  {
    name: "Luang Prabang",
    region: "North",
    districts: [
      "Luang Prabang",
      "Xieng Ngeun",
      "Nan",
      "Pak Ou",
      "Nambak",
      "Ngoi",
      "Pakxeng",
      "Phonxay",
      "Chomphet",
      "Viengkham",
    ],
  },
  {
    name: "Khammouane",
    region: "Central",
    districts: [
      "Thakhek",
      "Mahaxay",
      "Nongbok",
      "Hinboun",
      "Nhommalath",
      "Bualapha",
      "Nakai",
      "Xebangfay",
      "Xaybuathong",
    ],
  },
  {
    name: "Vientiane Province",
    region: "Central",
    districts: [
      "Phonhong",
      "Thoulakhom",
      "Keo Oudom",
      "Kasi",
      "Vangvieng",
      "Feuang",
      "Xanakharm",
      "Meun",
      "Viengkham",
    ],
  },
  {
    name: "Bokeo",
    region: "North",
    districts: ["Huayxai", "Tonpheung", "Meung", "Pha Oudom", "Paktha"],
  },
  {
    name: "Oudomxay",
    region: "North",
    districts: ["Xay", "La", "Namor", "Nga", "Beng", "Houn", "Pakbeng"],
  },
  {
    name: "Xayabouly",
    region: "North",
    districts: [
      "Xayabouly",
      "Khop",
      "Hongsa",
      "Ngeun",
      "Xienghone",
      "Phiang",
      "Paklai",
      "Kenethao",
      "Botene",
      "Thongmyxay",
    ],
  },
  {
    name: "Bolikhamxay",
    region: "Central",
    districts: [
      "Pakkading",
      "Thaphabath",
      "Pakxan",
      "Borikhan",
      "Khamkeuth",
      "Viengthong",
      "Xaychamphone",
    ],
  },
  {
    name: "Luang Namtha",
    region: "North",
    districts: ["Luang Namtha", "Sing", "Long", "Viengphoukha", "Nalae"],
  },
  {
    name: "Xieng Khouang",
    region: "North",
    districts: ["Pek", "Kham", "Nong Het", "Khoune", "Phaxay", "Phou Kout", "Thathom"],
  },
  {
    name: "Houaphanh",
    region: "North",
    districts: [
      "Xam Neua",
      "Xiengkhor",
      "Hiam",
      "Viengxay",
      "Huameuang",
      "Samtai",
      "Sophbao",
      "Et",
      "Kuan",
      "Xone",
    ],
  },
  {
    name: "Salavan",
    region: "South",
    districts: [
      "Salavan",
      "Ta Oy",
      "Toomlarn",
      "Lakhonepheng",
      "Vapy",
      "Khongsedone",
      "Lao Ngam",
      "Samuoi",
    ],
  },
  {
    name: "Attapeu",
    region: "South",
    districts: ["Samakkhixay", "Samaysy", "Phouvong", "Xanxay", "Sanamxay"],
  },
  {
    name: "Phongsaly",
    region: "North",
    districts: ["Phongsaly", "May", "Khoua", "Samphanh", "Boun Neua", "Nhot Ou", "Boun Tay"],
  },
  {
    name: "Xekong",
    region: "South",
    districts: ["Lamam", "Kaleum", "Dakchung", "Thateng"],
  },
  {
    name: "Xaisomboun",
    region: "Central",
    districts: ["Anouvong", "Longcheng", "Thathom", "Hom", "Longsane"],
  },
];

export const PROVINCE_NAMES = PROVINCES.map((province) => province.name) as [
  string,
  ...string[],
];

export const REGIONS = ["North", "Central", "South"] as const;

export function districtsFor(province: string): string[] {
  return PROVINCES.find((item) => item.name === province)?.districts ?? [];
}

export function isKnownProvince(province: string): boolean {
  return PROVINCES.some((item) => item.name === province);
}

export function isDistrictOfProvince(province: string, district: string): boolean {
  return districtsFor(province).includes(district);
}
