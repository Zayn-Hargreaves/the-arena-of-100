export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type Category =
  | "GENERAL"
  | "SCIENCE"
  | "HISTORY"
  | "GEOGRAPHY"
  | "TECHNOLOGY"
  | "SPORTS"
  | "CULTURE"
  | "LOGIC";

export interface Question {
  content: string;
  options: string[];
  /**
   * Must be one of the entries in the options array
   */
  correctAnswer: string;
  difficulty: Difficulty;
  category: Category;
  tags?: string[];
  explanation?: string;
}

export const questionSeeds: Question[] = [
  // ==========================================
  // 1. GEOGRAPHY (22 câu)
  // ==========================================
  {
    content: "Thủ đô của Việt Nam là gì?",
    options: ["Hà Nội", "Hồ Chí Minh", "Đà Nẵng", "Huế"],
    correctAnswer: "Hà Nội",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["Việt Nam", "chính trị"],
    explanation:
      "Hà Nội là thủ đô của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.",
  },
  {
    content: "Quốc gia nào có diện tích lớn nhất thế giới?",
    options: ["Mỹ", "Trung Quốc", "Nga", "Canada"],
    correctAnswer: "Nga",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["quốc gia", "diện tích"],
    explanation:
      "Nga là quốc gia có diện tích lớn nhất thế giới, chiếm khoảng 11% diện tích đất liền toàn cầu.",
  },
  {
    content: "Đại dương nào lớn nhất thế giới?",
    options: [
      "Đại Tây Dương",
      "Ấn Độ Dương",
      "Thái Bình Dương",
      "Bắc Băng Dương",
    ],
    correctAnswer: "Thái Bình Dương",
    difficulty: "MEDIUM",
    category: "GEOGRAPHY",
    tags: ["đại dương", "trái đất"],
    explanation:
      "Thái Bình Dương là đại dương lớn nhất thế giới, chiếm khoảng 1/3 diện tích bề mặt Trái Đất.",
  },
  {
    content: 'Thành phố nào được gọi là "Thành phố sương mù" ở Việt Nam?',
    options: ["Đà Lạt", "Sa Pa", "Tam Đảo", "Hà Giang"],
    correctAnswer: "Đà Lạt",
    difficulty: "MEDIUM",
    category: "GEOGRAPHY",
    tags: ["Việt Nam", "thành phố"],
    explanation:
      "Đà Lạt được gọi là 'Thành phố sương mù' do khí hậu mát mẻ và thường xuyên có sương mù vào buổi sáng.",
  },
  {
    content: "Dãy núi nào cao nhất thế giới?",
    options: ["Andes", "Himalaya", "Rocky", "Alps"],
    correctAnswer: "Himalaya",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["núi", "địa hình"],
    explanation:
      "Dãy Himalaya sở hữu đỉnh Everest cao nhất thế giới (8.848,86m).",
  },
  {
    content: "Sông nào dài nhất thế giới theo ghi nhận phổ biến?",
    options: ["Sông Nile", "Sông Amazon", "Sông Mê Kông", "Sông Dương Tử"],
    correctAnswer: "Sông Nile",
    difficulty: "MEDIUM",
    category: "GEOGRAPHY",
    tags: ["sông", "thế giới"],
    explanation:
      "Sông Nile ở châu Phi dài khoảng 6.650 km, được coi là con sông dài nhất thế giới.",
  },
  {
    content: "Quốc gia nào có hình dạng chữ S trên bản đồ thế giới?",
    options: ["Việt Nam", "Nhật Bản", "Ý", "Chile"],
    correctAnswer: "Việt Nam",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["đất nước", "bản đồ"],
    explanation:
      "Bản đồ đất liền nước Việt Nam trải dài với đường bờ biển uốn lượn hình chữ S.",
  },
  {
    content: "Sa mạc cát lớn nhất thế giới là gì?",
    options: ["Gobi", "Sahara", "Kalahari", "Atacama"],
    correctAnswer: "Sahara",
    difficulty: "MEDIUM",
    category: "GEOGRAPHY",
    tags: ["sa mạc", "châu Phi"],
    explanation:
      "Sahara là sa mạc cát nhiệt đới lớn nhất hành tinh nằm ở Bắc Phi.",
  },
  {
    content: "Hòn đảo lớn nhất thế giới theo diện tích là đảo nào?",
    options: ["Greenland", "Madagascar", "Borneo", "New Guinea"],
    correctAnswer: "Greenland",
    difficulty: "HARD",
    category: "GEOGRAPHY",
    tags: ["đảo", "diện tích"],
    explanation:
      "Greenland là đảo không thuộc lục địa lớn nhất thế giới với diện tích hơn 2,16 triệu km².",
  },
  {
    content:
      "Đỉnh núi cao nhất Việt Nam và được mệnh danh là 'Nóc nhà Đông Dương' là gì?",
    options: ["Fansipan", "Pu Si Lung", "Tây Côn Lĩnh", "Bạch Mộc Lương Tử"],
    correctAnswer: "Fansipan",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["Việt Nam", "núi cao"],
    explanation:
      "Đỉnh Fansipan cao 3.143m thuộc dãy Hoàng Liên Sơn, tỉnh Lào Cai.",
  },
  {
    content: "Quốc gia nào được mệnh danh là 'Đất nước mặt trời mọc'?",
    options: ["Nhật Bản", "Hàn Quốc", "Trung Quốc", "Thái Lan"],
    correctAnswer: "Nhật Bản",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["châu Á", "quốc gia"],
    explanation:
      "Nhật Bản nằm ở phía đông châu Á, nơi đón ánh bình minh sớm nhất trong khu vực.",
  },
  {
    content: "Thủ đô của nước Pháp là thành phố nào?",
    options: ["Paris", "Lyon", "Marseille", "Nice"],
    correctAnswer: "Paris",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["thủ đô", "châu Âu"],
    explanation:
      "Paris là thủ đô và là trung tâm văn hóa, kinh tế lớn nhất của Cộng hòa Pháp.",
  },
  {
    content:
      "Thác nước tự nhiên nổi tiếng nằm ở biên giới giữa Mỹ và Canada là gì?",
    options: ["Thác Niagara", "Thác Victoria", "Thác Angel", "Thác Iguazu"],
    correctAnswer: "Thác Niagara",
    difficulty: "MEDIUM",
    category: "GEOGRAPHY",
    tags: ["thác nước", "Bắc Mỹ"],
    explanation:
      "Thác Niagara là hệ thống ba thác nước nằm ở đường biên giới quốc tế giữa Mỹ và Canada.",
  },
  {
    content:
      "Kênh đào nhân tạo nổi tiếng nối liền Địa Trung Hải và Biển Đỏ là gì?",
    options: [
      "Kênh đào Suez",
      "Kênh đào Panama",
      "Kênh đào Corinth",
      "Kênh đào Kiel",
    ],
    correctAnswer: "Kênh đào Suez",
    difficulty: "MEDIUM",
    category: "GEOGRAPHY",
    tags: ["kênh đào", "hàng hải"],
    explanation:
      "Kênh đào Suez thuộc Ai Cập mở đường hàng hải huyết mạch giữa châu Âu và châu Á.",
  },
  {
    content:
      "Hang động tự nhiên lớn nhất thế giới nằm ở tỉnh Quảng Bình, Việt Nam là gì?",
    options: [
      "Hang Sơn Đoòng",
      "Động Phong Nha",
      "Động Thiên Đường",
      "Hang Én",
    ],
    correctAnswer: "Hang Sơn Đoòng",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["hang động", "kỳ quan"],
    explanation:
      "Hang Sơn Đoòng tại Vườn quốc gia Phong Nha - Kẻ Bàng là hang động tự nhiên lớn nhất thế giới.",
  },
  {
    content:
      "Hồ nước ngọt tự nhiên sâu nhất và lâu đời nhất thế giới là hồ nào?",
    options: ["Hồ Baikal", "Hồ Superior", "Hồ Victoria", "Hồ Michigan"],
    correctAnswer: "Hồ Baikal",
    difficulty: "HARD",
    category: "GEOGRAPHY",
    tags: ["hồ nước", "Nga"],
    explanation:
      "Hồ Baikal ở Siberia (Nga) có độ sâu tối đa 1.642m và chứa khoảng 20% lượng nước ngọt không đóng băng của thế giới.",
  },
  {
    content: "Quốc gia nào hiện có quy mô dân số đông nhất thế giới?",
    options: ["Ấn Độ", "Trung Quốc", "Mỹ", "Indonesia"],
    correctAnswer: "Ấn Độ",
    difficulty: "MEDIUM",
    category: "GEOGRAPHY",
    tags: ["dân số", "quốc tế"],
    explanation:
      "Theo thống kê của Liên Hợp Quốc năm 2023, Ấn Độ đã vượt qua Trung Quốc để trở thành quốc gia đông dân nhất.",
  },
  {
    content:
      "Châu lục có diện tích tự nhiên nhỏ nhất trên Trái Đất là châu lục nào?",
    options: ["Châu Đại Dương", "Châu Âu", "Châu Nam Cực", "Châu Mỹ"],
    correctAnswer: "Châu Đại Dương",
    difficulty: "MEDIUM",
    category: "GEOGRAPHY",
    tags: ["châu lục", "địa lý"],
    explanation:
      "Châu Đại Dương (châu Úc) có diện tích khoảng 8,5 triệu km², nhỏ nhất trong các châu lục.",
  },
  {
    content:
      "Thành phố Hải Phòng ở Việt Nam được mệnh danh là thành phố hoa gì?",
    options: ["Hoa Phượng Đỏ", "Hoa Sữa", "Hoa Ban", "Hoa Mai"],
    correctAnswer: "Hoa Phượng Đỏ",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["thành phố", "Việt Nam"],
    explanation:
      "Hải Phòng nổi tiếng với những hàng cây hoa phượng vĩ rực rỡ và được gọi là 'Thành phố Hoa phượng đỏ'.",
  },
  {
    content:
      "Sông Mê Kông chảy qua lãnh thổ của bao nhiêu quốc gia trước khi đổ ra biển?",
    options: ["6 quốc gia", "4 quốc gia", "5 quốc gia", "7 quốc gia"],
    correctAnswer: "6 quốc gia",
    difficulty: "HARD",
    category: "GEOGRAPHY",
    tags: ["sông ngòi", "Đông Nam Á"],
    explanation:
      "Sông Mê Kông chảy qua Trung Quốc, Myanmar, Lào, Thái Lan, Campuchia và Việt Nam.",
  },
  {
    content: "Đất nước nào ở Đông Nam Á được mệnh danh là 'Xứ sở Chùa Vàng'?",
    options: ["Thái Lan", "Myanmar", "Campuchia", "Lào"],
    correctAnswer: "Thái Lan",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["du lịch", "Đông Nam Á"],
    explanation:
      "Thái Lan được gọi là Xứ sở Chùa Vàng nhờ hàng ngàn ngôi chùa Phật giáo tráng lệ thếp vàng rực rỡ.",
  },
  {
    content:
      "Eo biển nào ngăn cách giữa châu Á và châu Mỹ (giữa Nga và Alaska)?",
    options: [
      "Eo biển Bering",
      "Eo biển Malacca",
      "Eo biển Gibraltar",
      "Eo biển Magellan",
    ],
    correctAnswer: "Eo biển Bering",
    difficulty: "HARD",
    category: "GEOGRAPHY",
    tags: ["eo biển", "thế giới"],
    explanation:
      "Eo biển Bering nối liền biển Bering với biển Chukchi, phân cách châu Á và Bắc Mỹ.",
  },

  // ==========================================
  // 2. SCIENCE (22 câu)
  // ==========================================
  {
    content: "Mặt trời mọc ở hướng nào?",
    options: ["Đông", "Tây", "Nam", "Bắc"],
    correctAnswer: "Đông",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["thiên văn", "tự nhiên"],
    explanation:
      "Mặt trời mọc ở hướng Đông và lặn ở hướng Tây do Trái Đất quay từ Tây sang Đông.",
  },
  {
    content: "Nước sôi ở nhiệt độ bao nhiêu độ C?",
    options: ["50°C", "80°C", "100°C", "120°C"],
    correctAnswer: "100°C",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["vật lý", "nhiệt độ"],
    explanation:
      "Nước sôi ở 100 độ Celsius ở điều kiện áp suất khí quyển tiêu chuẩn.",
  },
  {
    content: 'Nguyên tố hóa học nào có ký hiệu là "Fe"?',
    options: ["Fluorine", "Iron (Sắt)", "Francium", "Fermium"],
    correctAnswer: "Iron (Sắt)",
    difficulty: "MEDIUM",
    category: "SCIENCE",
    tags: ["hóa học", "kim loại"],
    explanation:
      "Fe là ký hiệu hóa học của nguyên tố Iron (Sắt) trong bảng tuần hoàn.",
  },
  {
    content: "Trong vật lý, đơn vị đo cường độ dòng điện là gì?",
    options: ["Volt", "Watt", "Ampere", "Ohm"],
    correctAnswer: "Ampere",
    difficulty: "HARD",
    category: "SCIENCE",
    tags: ["vật lý", "điện"],
    explanation:
      "Ampere (A) là đơn vị đo cường độ dòng điện trong hệ SI, đặt theo tên nhà vật lý André-Marie Ampère.",
  },
  {
    content: "Khoảng cách từ Trái Đất đến Mặt Trời là bao nhiêu km?",
    options: ["100 triệu km", "150 triệu km", "200 triệu km", "250 triệu km"],
    correctAnswer: "150 triệu km",
    difficulty: "HARD",
    category: "SCIENCE",
    tags: ["thiên văn", "khoảng cách"],
    explanation:
      "Khoảng cách trung bình từ Trái Đất đến Mặt Trời là khoảng 150 triệu km, còn gọi là 1 đơn vị thiên văn (AU).",
  },
  {
    content: "Hành tinh nào có thời gian một ngày dài hơn một năm?",
    options: ["Sao Thủy", "Sao Kim", "Sao Hỏa", "Sao Thổ"],
    correctAnswer: "Sao Kim",
    difficulty: "HARD",
    category: "SCIENCE",
    tags: ["thiên văn", "hành tinh"],
    explanation:
      "Sao Kim có chu kỳ tự quay rất chậm (243 ngày Trái Đất) trong khi quỹ đạo quay quanh Mặt Trời chỉ mất 225 ngày Trái Đất.",
  },
  {
    content: "Công thức hóa học của khí Oxy mà con người hít thở là gì?",
    options: ["O2", "CO2", "H2O", "N2"],
    correctAnswer: "O2",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["hóa học", "khí quyển"],
    explanation:
      "Khí oxy gồm 2 nguyên tử oxy liên kết với nhau, ký hiệu là O2.",
  },
  {
    content:
      "Cơ quan nào trong cơ thể người chịu trách nhiệm bơm máu đi khắp cơ thể?",
    options: ["Tim", "Phổi", "Gan", "Thận"],
    correctAnswer: "Tim",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["sinh học", "cơ thể"],
    explanation:
      "Trái tim hoạt động như một máy bơm tuần hoàn máu nuôi dưỡng toàn bộ cơ thể.",
  },
  {
    content: "Vận tốc ánh sáng trong chân không xấp xỉ bao nhiêu?",
    options: ["300.000 km/s", "150.000 km/s", "30.000 km/s", "1.000.000 km/s"],
    correctAnswer: "300.000 km/s",
    difficulty: "MEDIUM",
    category: "SCIENCE",
    tags: ["vật lý", "vận tốc"],
    explanation:
      "Vận tốc ánh sáng xấp xỉ 299.792.458 m/s (khoảng 300.000 km/s).",
  },
  {
    content: "Khí nào chiếm tỉ lệ phần trăm lớn nhất trong khí quyển Trái Đất?",
    options: ["Nitơ (N2)", "Oxy (O2)", "Cacbonic (CO2)", "Argon (Ar)"],
    correctAnswer: "Nitơ (N2)",
    difficulty: "MEDIUM",
    category: "SCIENCE",
    tags: ["khí quyển", "hóa học"],
    explanation: "Khí Nitơ chiếm khoảng 78% thể tích bầu khí quyển Trái Đất.",
  },
  {
    content: "Công thức hóa học quen thuộc của nước nguyên chất là gì?",
    options: ["H2O", "CO2", "NaCl", "H2SO4"],
    correctAnswer: "H2O",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["hóa học", "nước"],
    explanation:
      "Mỗi phân tử nước được cấu tạo từ 2 nguyên tử Hydro và 1 nguyên tử Oxy.",
  },
  {
    content: "Hành tinh nào nằm ở vị trí gần Mặt Trời nhất trong Hệ Mặt Trời?",
    options: ["Sao Thủy", "Sao Kim", "Trái Đất", "Sao Hỏa"],
    correctAnswer: "Sao Thủy",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["hệ mặt trời", "thiên văn"],
    explanation:
      "Sao Thủy (Mercury) là hành tinh gần Mặt Trời nhất với khoảng cách trung bình khoảng 58 triệu km.",
  },
  {
    content:
      "Bào quan nào được ví như 'nhà máy năng lượng' của tế bào sinh vật nhân thực?",
    options: ["Ty thể", "Nhân tế bào", "Ribosome", "Lưới nội chất"],
    correctAnswer: "Ty thể",
    difficulty: "MEDIUM",
    category: "SCIENCE",
    tags: ["tế bào", "sinh học"],
    explanation:
      "Ty thể (Mitochondria) tạo ra phần lớn năng lượng ATP phục vụ mọi hoạt động sống của tế bào.",
  },
  {
    content:
      "Đơn vị đo điện áp (hiệu điện thế) trong hệ đo lường quốc tế SI là gì?",
    options: ["Volt (V)", "Ampere (A)", "Ohm (Ω)", "Joule (J)"],
    correctAnswer: "Volt (V)",
    difficulty: "MEDIUM",
    category: "SCIENCE",
    tags: ["điện học", "đơn vị"],
    explanation:
      "Volt là đơn vị đo hiệu điện thế, đặt theo tên nhà bác học người Ý Alessandro Volta.",
  },
  {
    content: "Lực nào giữ cho các hành tinh quay quanh quỹ đạo của Mặt Trời?",
    options: ["Lực hấp dẫn", "Lực ma sát", "Lực điện từ", "Lực đẩy Archimedes"],
    correctAnswer: "Lực hấp dẫn",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["vật lý", "lực"],
    explanation:
      "Lực hấp dẫn giữa Mặt Trời và các thiên thể giữ chúng chuyển động theo các quỹ đạo elip xác định.",
  },
  {
    content:
      "Kim loại duy nhất tồn tại ở thể lỏng ở điều kiện nhiệt độ phòng tiêu chuẩn là gì?",
    options: ["Thủy ngân (Hg)", "Chì (Pb)", "Nhôm (Al)", "Vàng (Au)"],
    correctAnswer: "Thủy ngân (Hg)",
    difficulty: "MEDIUM",
    category: "SCIENCE",
    tags: ["kim loại", "hóa học"],
    explanation:
      "Thủy ngân có nhiệt độ nóng chảy rất thấp (-38,83°C) nên ở thể lỏng trong điều kiện thường.",
  },
  {
    content:
      "Kim cương tự nhiên có thành phần cấu tạo từ nguyên tố hóa học nào?",
    options: ["Cacbon (C)", "Silic (Si)", "Lưu huỳnh (S)", "Sắt (Fe)"],
    correctAnswer: "Cacbon (C)",
    difficulty: "MEDIUM",
    category: "SCIENCE",
    tags: ["khoáng sản", "hóa học"],
    explanation:
      "Kim cương là dạng thù hình của nguyên tố Cacbon với cấu trúc mạng tinh thể lập phương siêu cứng.",
  },
  {
    content: "Loài động vật nào có trái tim lớn nhất thế giới hiện nay?",
    options: ["Cá voi xanh", "Voi châu Phi", "Hươu cao cổ", "Hà mã"],
    correctAnswer: "Cá voi xanh",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["động vật", "sinh vật"],
    explanation:
      "Trái tim của cá voi xanh trưởng thành có thể nặng tới 180 kg và to bằng kích thước một chiếc xe hơi nhỏ.",
  },
  {
    content: "Vệ tinh tự nhiên duy nhất quay quanh Trái Đất là thiên thể nào?",
    options: ["Mặt Trăng", "Sao Hỏa", "Mặt Trời", "Sao Kim"],
    correctAnswer: "Mặt Trăng",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["vệ tinh", "thiên văn"],
    explanation:
      "Mặt Trăng là vệ tinh tự nhiên duy nhất của Trái Đất, cách Trái Đất khoảng 384.400 km.",
  },
  {
    content:
      "Thang đo pH từ 0 đến 14 dùng để biểu thị tính chất gì của dung dịch?",
    options: ["Độ axit hoặc bazơ", "Độ mặn", "Độ đục", "Nhiệt độ sôi"],
    correctAnswer: "Độ axit hoặc bazơ",
    difficulty: "MEDIUM",
    category: "SCIENCE",
    tags: ["hóa học", "pH"],
    explanation:
      "pH < 7 là môi trường axit, pH = 7 là trung tính, và pH > 7 là môi trường bazơ (kiềm).",
  },
  {
    content:
      "Hiện tượng cầu vồng nhiều màu xuất hiện sau mưa là do hiện tượng quang học nào?",
    options: [
      "Tán sắc ánh sáng",
      "Phản xạ toàn phần",
      "Giao thoa ánh sáng",
      "Nhiễu xạ ánh sáng",
    ],
    correctAnswer: "Tán sắc ánh sáng",
    difficulty: "HARD",
    category: "SCIENCE",
    tags: ["quang học", "vật lý"],
    explanation:
      "Các giọt nước mưa đóng vai trò như lăng kính làm khúc xạ và tán sắc ánh sáng mặt trời thành 7 màu.",
  },
  {
    content:
      "Trong y học truyền máu, nhóm máu nào được coi là nhóm máu 'chuyên cho' phổ biến?",
    options: ["Nhóm máu O", "Nhóm máu A", "Nhóm máu B", "Nhóm máu AB"],
    correctAnswer: "Nhóm máu O",
    difficulty: "HARD",
    category: "SCIENCE",
    tags: ["y học", "máu"],
    explanation:
      "Hồng cầu nhóm máu O không có kháng nguyên A và B nên có thể truyền cho người mang các nhóm máu khác.",
  },

  // ==========================================
  // 3. TECHNOLOGY (22 câu)
  // ==========================================
  {
    content: "Đâu là mạng xã hội lớn nhất thế giới?",
    options: ["Twitter", "TikTok", "Facebook", "Instagram"],
    correctAnswer: "Facebook",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["mạng xã hội", "internet"],
    explanation:
      "Facebook là mạng xã hội lớn nhất thế giới tính theo số lượng người dùng hoạt động hàng tháng.",
  },
  {
    content: "Ai là người sáng lập ra Facebook?",
    options: ["Bill Gates", "Mark Zuckerberg", "Steve Jobs", "Elon Musk"],
    correctAnswer: "Mark Zuckerberg",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["lập trình", "doanh nhân"],
    explanation:
      "Mark Zuckerberg là người sáng lập Facebook vào năm 2004 khi còn là sinh viên Harvard.",
  },
  {
    content: "Python là ngôn ngữ lập trình được tạo ra bởi ai?",
    options: [
      "James Gosling",
      "Guido van Rossum",
      "Bjarne Stroustrup",
      "Dennis Ritchie",
    ],
    correctAnswer: "Guido van Rossum",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["lập trình", "ngôn ngữ"],
    explanation:
      "Guido van Rossum là người tạo ra ngôn ngữ lập trình Python vào cuối những năm 1980.",
  },
  {
    content: "HTTP status code 404 có ý nghĩa gì?",
    options: ["Server Error", "Unauthorized", "Not Found", "Forbidden"],
    correctAnswer: "Not Found",
    difficulty: "HARD",
    category: "TECHNOLOGY",
    tags: ["web", "HTTP"],
    explanation:
      "Mã lỗi HTTP 404 có nghĩa là 'Not Found' - tài nguyên được yêu cầu không được tìm thấy trên máy chủ.",
  },
  {
    content:
      "Hệ điều hành Android được phát triển ban đầu và sở hữu bởi tập đoàn nào?",
    options: ["Google", "Apple", "Microsoft", "Samsung"],
    correctAnswer: "Google",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["di động", "hệ điều hành"],
    explanation:
      "Google đã mua lại Android Inc. vào năm 2005 và phát triển thành hệ điều hành di động phổ biến nhất thế giới.",
  },
  {
    content: "Công ty nào đã tạo ra mô hình AI ChatGPT gây sốt toàn cầu?",
    options: ["OpenAI", "DeepMind", "Meta", "Anthropic"],
    correctAnswer: "OpenAI",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["trí tuệ nhân tạo", "AI"],
    explanation:
      "OpenAI ra mắt ChatGPT vào tháng 11/2022 mở đầu cho làn sóng Generative AI.",
  },
  {
    content: "Trong lập trình web, HTML là viết tắt của cụm từ nào?",
    options: [
      "HyperText Markup Language",
      "High Tech Modern Language",
      "Hyper Transfer Mode Link",
      "Home Tool Markup Logic",
    ],
    correctAnswer: "HyperText Markup Language",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["frontend", "web dev"],
    explanation:
      "HTML là ngôn ngữ đánh dấu siêu văn bản dùng để xây dựng cấu trúc trang web.",
  },
  {
    content: "CPU trong máy tính là viết tắt của từ gì?",
    options: [
      "Central Processing Unit",
      "Computer Personal Unit",
      "Core Program Utility",
      "Central Power Unit",
    ],
    correctAnswer: "Central Processing Unit",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["phần cứng", "máy tính"],
    explanation:
      "CPU là bộ vi xử lý trung tâm, đóng vai trò như bộ não của máy tính.",
  },
  {
    content:
      "Ngôn ngữ lập trình nào thường được gọi là 'ngôn ngữ của web' chạy trên trình duyệt?",
    options: ["JavaScript", "C++", "Java", "Python"],
    correctAnswer: "JavaScript",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["lập trình", "web"],
    explanation:
      "JavaScript là ngôn ngữ tiêu chuẩn chạy trên tất cả các trình duyệt web hiện đại.",
  },
  {
    content:
      "Ai được coi là người phát minh ra mạng lưới toàn cầu World Wide Web (WWW)?",
    options: [
      "Tim Berners-Lee",
      "Alan Turing",
      "Linus Torvalds",
      "Steve Wozniak",
    ],
    correctAnswer: "Tim Berners-Lee",
    difficulty: "HARD",
    category: "TECHNOLOGY",
    tags: ["lịch sử IT", "internet"],
    explanation:
      "Ngài Tim Berners-Lee phát minh ra World Wide Web vào năm 1989 khi làm việc tại CERN.",
  },
  {
    content:
      "Hệ điều hành mã nguồn mở Linux được khởi xướng và phát triển bởi ai vào năm 1991?",
    options: [
      "Linus Torvalds",
      "Richard Stallman",
      "Ken Thompson",
      "Dennis Ritchie",
    ],
    correctAnswer: "Linus Torvalds",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["Linux", "mã nguồn mở"],
    explanation:
      "Linus Torvalds đã viết nhân hệ điều hành Linux và phát hành miễn phí cho cộng đồng lập trình thế giới.",
  },
  {
    content:
      "Chiếc điện thoại iPhone thế hệ đầu tiên được Steve Jobs giới thiệu vào năm nào?",
    options: ["2007", "2005", "2008", "2010"],
    correctAnswer: "2007",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["Apple", "iPhone"],
    explanation:
      "Steve Jobs giới thiệu chiếc iPhone đầu tiên tại hội nghị Macworld vào ngày 9 tháng 1 năm 2007.",
  },
  {
    content: "Bộ nhớ RAM trong máy tính là viết tắt của cụm từ tiếng Anh nào?",
    options: [
      "Random Access Memory",
      "Read All Memory",
      "Rapid Action Module",
      "Run Auto Memory",
    ],
    correctAnswer: "Random Access Memory",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["phần cứng", "RAM"],
    explanation:
      "RAM là bộ nhớ truy xuất ngẫu nhiên tạm thời dùng để lưu dữ liệu xử lý của CPU.",
  },
  {
    content:
      "Ngôn ngữ truy vấn cơ sở dữ liệu quan hệ SQL là viết tắt của từ gì?",
    options: [
      "Structured Query Language",
      "Simple Quick Logic",
      "Standard Question List",
      "Server Query Layout",
    ],
    correctAnswer: "Structured Query Language",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["database", "SQL"],
    explanation:
      "SQL là ngôn ngữ tiêu chuẩn để lưu trữ, truy xuất và thao tác dữ liệu trong các hệ quản trị CSDL.",
  },
  {
    content:
      "Giao thức web bảo mật có biểu tượng ổ khóa an toàn trên trình duyệt là gì?",
    options: ["HTTPS", "HTTP", "FTP", "SSH"],
    correctAnswer: "HTTPS",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["bảo mật", "web"],
    explanation:
      "HTTPS mã hóa dữ liệu truyền qua mạng bằng giao thức SSL/TLS để bảo vệ thông tin người dùng.",
  },
  {
    content:
      "Theo quy chuẩn tính toán nhị phân máy tính, 1 Gigabyte (GB) bằng bao nhiêu Megabyte (MB)?",
    options: ["1024 MB", "1000 MB", "512 MB", "2048 MB"],
    correctAnswer: "1024 MB",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["dung lượng", "máy tính"],
    explanation:
      "Trong hệ nhị phân (lũy thừa cơ số 2), 1 GB = 2^10 MB = 1024 MB.",
  },
  {
    content:
      "Chuẩn cổng kết nối có thể đảo chiều cắm phổ biến nhất trên smartphone hiện nay là gì?",
    options: ["USB-C", "Micro-USB", "Lightning", "Mini-USB"],
    correctAnswer: "USB-C",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["phần cứng", "cổng cắm"],
    explanation:
      "USB-C là chuẩn kết nối đối xứng truyền dữ liệu và sạc nhanh tốc độ cao trên toàn thế giới.",
  },
  {
    content:
      "Công nghệ kết nối không dây tầm ngắn dùng cho tai nghe và phụ kiện có tên là gì?",
    options: ["Bluetooth", "NFC", "Wi-Fi Direct", "Infrared"],
    correctAnswer: "Bluetooth",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["kết nối", "không dây"],
    explanation:
      "Bluetooth là chuẩn kết nối không dây khoảng cách ngắn được phát triển bởi Ericsson.",
  },
  {
    content:
      "Card đồ họa GPU trong máy tính chuyên dùng để xử lý tác vụ gì hiệu quả nhất?",
    options: [
      "Đồ họa và tính toán song song",
      "Lưu trữ dữ liệu vĩnh viễn",
      "Quản lý nguồn điện",
      "Giao tiếp mạng Internet",
    ],
    correctAnswer: "Đồ họa và tính toán song song",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["GPU", "phần cứng"],
    explanation:
      "GPU có hàng ngàn nhân xử lý song song, tối ưu cho xử lý hình ảnh 3D và huấn luyện mô hình AI.",
  },
  {
    content:
      "Trí tuệ nhân tạo AlphaGo của Google DeepMind đã đánh bại kiện tướng thế giới ở môn cờ nào?",
    options: ["Cờ vây", "Cờ vua", "Cờ tướng", "Cờ caro"],
    correctAnswer: "Cờ vây",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["AI", "cờ vây"],
    explanation:
      "Năm 2016, AlphaGo đã đánh bại đại kiện tướng cờ vây Lee Sedol 4-1, cột mốc lịch sử của AI.",
  },
  {
    content:
      "Ngôn ngữ lập trình TypeScript (nâng cấp có kiểu tĩnh cho JavaScript) do tập đoàn nào tạo ra?",
    options: ["Microsoft", "Google", "Facebook", "Amazon"],
    correctAnswer: "Microsoft",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["lập trình", "TypeScript"],
    explanation:
      "TypeScript do Anders Hejlsberg tại Microsoft thiết kế và ra mắt lần đầu năm 2012.",
  },
  {
    content:
      "Công nghệ sổ cái phân tán bảo mật đứng sau các loại tiền mã hóa như Bitcoin được gọi là gì?",
    options: ["Blockchain", "Cloud Computing", "Big Data", "Neural Network"],
    correctAnswer: "Blockchain",
    difficulty: "HARD",
    category: "TECHNOLOGY",
    tags: ["blockchain", "tiền tệ"],
    explanation:
      "Blockchain là chuỗi các khối dữ liệu liên kết mã hóa bất biến, đảm bảo tính phi tập trung và minh bạch.",
  },

  // ==========================================
  // 4. HISTORY (22 câu)
  // ==========================================
  {
    content: "Năm nào Việt Nam giành độc lập?",
    options: ["1945", "1954", "1975", "1986"],
    correctAnswer: "1945",
    difficulty: "MEDIUM",
    category: "HISTORY",
    tags: ["Việt Nam", "độc lập"],
    explanation:
      "Việt Nam giành độc lập vào ngày 2/9/1945 khi Chủ tịch Hồ Chí Minh đọc Tuyên ngôn Độc lập.",
  },
  {
    content: "Trong lịch sử, trận Điện Biên Phủ diễn ra vào năm nào?",
    options: ["1945", "1954", "1968", "1975"],
    correctAnswer: "1954",
    difficulty: "HARD",
    category: "HISTORY",
    tags: ["Việt Nam", "chiến tranh"],
    explanation:
      "Trận Điện Biên Phủ diễn ra từ ngày 13/3 đến 7/5/1954, kết thúc bằng chiến thắng quyết định của Quân đội Nhân dân Việt Nam.",
  },
  {
    content: "Chiến tranh Thế giới thứ Hai chính thức kết thúc vào năm nào?",
    options: ["1945", "1939", "1918", "1950"],
    correctAnswer: "1945",
    difficulty: "EASY",
    category: "HISTORY",
    tags: ["thế chiến", "thế giới"],
    explanation:
      "Chiến tranh Thế giới thứ Hai kết thúc vào năm 1945 sau khi phe Trục đầu hàng vô điều kiện.",
  },
  {
    content: "Vị vua đầu tiên của triều đại nhà Lý ở Việt Nam là ai?",
    options: ["Lý Thái Tổ", "Lý Thái Tông", "Lý Nhân Tông", "Lý Thường Kiệt"],
    correctAnswer: "Lý Thái Tổ",
    difficulty: "MEDIUM",
    category: "HISTORY",
    tags: ["triều đại", "nhà Lý"],
    explanation:
      "Lý Thái Tổ (Lý Công Uẩn) sáng lập nhà Lý năm 1009 và dời đô về Thăng Long năm 1010.",
  },
  {
    content:
      "Tượng Nữ thần Tự do ở New York là món quà từ quốc gia nào tặng nước Mỹ?",
    options: ["Pháp", "Anh", "Đức", "Ý"],
    correctAnswer: "Pháp",
    difficulty: "MEDIUM",
    category: "HISTORY",
    tags: ["Mỹ", "Pháp"],
    explanation:
      "Pháp tặng Tượng Nữ thần Tự do cho Mỹ năm 1886 để kỷ niệm quan hệ đồng minh thời kỳ Cách mạng Mỹ.",
  },
  {
    content: "Kim tự tháp Giza nổi tiếng nằm ở quốc gia nào ngày nay?",
    options: ["Ai Cập", "Hy Lạp", "Iran", "Iraq"],
    correctAnswer: "Ai Cập",
    difficulty: "EASY",
    category: "HISTORY",
    tags: ["cổ đại", "kỳ quan"],
    explanation:
      "Quần thể kim tự tháp Giza là di tích cổ đại vĩ đại của nền văn minh Ai Cập cổ.",
  },
  {
    content:
      "Trận chiến trên sông Bạch Đằng năm 938 do ai lãnh đạo đánh tan quân Nam Hán?",
    options: ["Ngô Quyền", "Trần Hưng Đạo", "Lê Hoàn", "Quang Trung"],
    correctAnswer: "Ngô Quyền",
    difficulty: "EASY",
    category: "HISTORY",
    tags: ["Bạch Đằng", "chiến công"],
    explanation:
      "Ngô Quyền dùng cọc gỗ bọc sắt cắm dưới lòng sông Bạch Đằng đánh tan quân Nam Hán năm 938.",
  },
  {
    content:
      "Bức tường Berlin sụp đổ vào năm nào, mở đầu cho việc thống nhất nước Đức?",
    options: ["1989", "1991", "1975", "1985"],
    correctAnswer: "1989",
    difficulty: "HARD",
    category: "HISTORY",
    tags: ["chiến tranh lạnh", "châu Âu"],
    explanation:
      "Bức tường Berlin sụp đổ ngày 9/11/1989, đánh dấu bước ngoặt chấm dứt Chiến tranh Lạnh.",
  },
  {
    content:
      "Vị tướng tài ba ba lần lãnh đạo quân dân Đại Việt đánh tan giặc Mông - Nguyên ở thế kỷ XIII là ai?",
    options: [
      "Trần Hưng Đạo",
      "Trần Quang Khải",
      "Trần Nhật Duật",
      "Phạm Ngũ Lão",
    ],
    correctAnswer: "Trần Hưng Đạo",
    difficulty: "EASY",
    category: "HISTORY",
    tags: ["nhà Trần", "anh hùng"],
    explanation:
      "Hưng Đạo Đại Vương Trần Quốc Tuấn là vị chỉ huy quân sự kiệt xuất trong lịch sử chống ngoại xâm.",
  },
  {
    content:
      "Ngày Giải phóng miền Nam, thống nhất hoàn toàn đất nước Việt Nam là ngày nào?",
    options: ["30/4/1975", "2/9/1945", "7/5/1954", "19/8/1945"],
    correctAnswer: "30/4/1975",
    difficulty: "EASY",
    category: "HISTORY",
    tags: ["thống nhất", "Việt Nam"],
    explanation:
      "Ngày 30 tháng 4 năm 1975 đánh dấu thắng lợi của Chiến dịch Hồ Chí Minh, thống nhất non sông.",
  },
  {
    content:
      "Phi thuyền Apollo 11 đưa con người lần đầu tiên đặt chân lên Mặt Trăng vào năm nào?",
    options: ["1969", "1965", "1972", "1961"],
    correctAnswer: "1969",
    difficulty: "MEDIUM",
    category: "HISTORY",
    tags: ["vũ trụ", "NASA"],
    explanation:
      "Ngày 20/7/1969, phi hành gia Neil Armstrong đã đặt bước chân lịch sử đầu tiên lên bề mặt Mặt Trăng.",
  },
  {
    content:
      "Nhà thám hiểm nào dẫn đầu đoàn tàu vượt Đại Tây Dương và tìm ra châu Mỹ vào năm 1492?",
    options: [
      "Christopher Columbus",
      "Ferdinand Magellan",
      "Vasco da Gama",
      "Marco Polo",
    ],
    correctAnswer: "Christopher Columbus",
    difficulty: "EASY",
    category: "HISTORY",
    tags: ["thám hiểm", "châu Mỹ"],
    explanation:
      "Christopher Columbus người Ý chỉ huy chuyến hải trình dưới cờ Tây Ban Nha cập bến châu Mỹ năm 1492.",
  },
  {
    content: "Cuộc Cách mạng Tháng Mười Nga lịch sử bùng nổ vào năm nào?",
    options: ["1917", "1905", "1921", "1914"],
    correctAnswer: "1917",
    difficulty: "MEDIUM",
    category: "HISTORY",
    tags: ["Cách mạng", "Nga"],
    explanation:
      "Cách mạng Tháng Mười Nga năm 1917 do V.I. Lênin và Đảng Bolshevik lãnh đạo đã khai sinh nhà nước Xô Viết.",
  },
  {
    content:
      "Vị hoàng đế cuối cùng của chế độ phong kiến Việt Nam thoái vị vào năm 1945 là ai?",
    options: ["Vua Bảo Đại", "Vua Khải Định", "Vua Hàm Nghi", "Vua Duy Tân"],
    correctAnswer: "Vua Bảo Đại",
    difficulty: "EASY",
    category: "HISTORY",
    tags: ["nhà Nguyễn", "phong kiến"],
    explanation:
      "Vua Bảo Đại thoái vị ngày 30/8/1945 tại kinh thành Huế với câu nói nổi tiếng 'Thà làm dân một nước tự do còn hơn làm vua một nước nô lệ'.",
  },
  {
    content:
      "Thành phố cổ Pompeii của La Mã bị chôn vùi bởi ngọn núi lửa nào phun trào năm 79 SCN?",
    options: [
      "Núi lửa Vesuvius",
      "Núi lửa Etna",
      "Núi lửa Krakatoa",
      "Núi lửa Fuji",
    ],
    correctAnswer: "Núi lửa Vesuvius",
    difficulty: "HARD",
    category: "HISTORY",
    tags: ["cổ đại", "núi lửa"],
    explanation:
      "Vụ phun trào khủng khiếp của núi lửa Vesuvius đã bảo tồn nguyên vẹn thành phố Pompeii dưới lớp tro bụi hàng ngàn năm.",
  },
  {
    content:
      "Tổ chức quốc tế Liên Hợp Quốc (United Nations) chính thức được thành lập vào năm nào?",
    options: ["1945", "1919", "1948", "1950"],
    correctAnswer: "1945",
    difficulty: "MEDIUM",
    category: "HISTORY",
    tags: ["Liên Hợp Quốc", "quốc tế"],
    explanation:
      "Liên Hợp Quốc được thành lập vào ngày 24/10/1945 sau Chiến tranh Thế giới thứ Hai nhằm duy trì hòa bình và an ninh thế giới.",
  },
  {
    content:
      "Cuộc khởi nghĩa Hai Bà Trưng chống lại ách đô hộ của nhà Đông Hán diễn ra vào năm nào?",
    options: ["Năm 40 SCN", "Năm 938", "Năm 248", "Năm 542"],
    correctAnswer: "Năm 40 SCN",
    difficulty: "MEDIUM",
    category: "HISTORY",
    tags: ["Hai Bà Trưng", "khởi nghĩa"],
    explanation:
      "Trưng Trắc và Trưng Nhị phất cờ khởi nghĩa vào mùa xuân năm 40 sau Công nguyên tại Hát Môn.",
  },
  {
    content:
      "Đế chế La Mã cổ đại có thủ đô và trung tâm quyền lực ban đầu đặt tại thành phố nào?",
    options: ["Roma", "Athens", "Alexandria", "Constantinople"],
    correctAnswer: "Roma",
    difficulty: "EASY",
    category: "HISTORY",
    tags: ["La Mã", "châu Âu"],
    explanation:
      "Thành phố Roma (Ý) là cái nôi khởi nguồn của một trong những đế chế hùng mạnh nhất lịch sử nhân loại.",
  },
  {
    content:
      "Bản Hiến pháp đầu tiên của nước Việt Nam Dân chủ Cộng hòa được Quốc hội thông qua vào năm nào?",
    options: ["1946", "1945", "1959", "1980"],
    correctAnswer: "1946",
    difficulty: "HARD",
    category: "HISTORY",
    tags: ["Hiến pháp", "Quốc hội"],
    explanation:
      "Hiến pháp năm 1946 là bản hiến pháp đầu tiên trong lịch sử lập hiến của nước Việt Nam.",
  },
  {
    content: "Ai là vị Tổng thống đầu tiên của Hợp chúng quốc Hoa Kỳ?",
    options: [
      "George Washington",
      "Thomas Jefferson",
      "Abraham Lincoln",
      "John Adams",
    ],
    correctAnswer: "George Washington",
    difficulty: "EASY",
    category: "HISTORY",
    tags: ["tổng thống", "nước Mỹ"],
    explanation:
      "George Washington nhậm chức năm 1789 và là vị cha già lập quốc của nước Mỹ.",
  },
  {
    content:
      "Chiến thắng Ngọc Hồi - Đống Đa quét sạch 29 vạn quân Mãn Thanh mùa xuân năm Kỷ Dậu do ai chỉ huy?",
    options: ["Vua Quang Trung", "Nguyễn Nhạc", "Nguyễn Lữ", "Ngô Thì Nhậm"],
    correctAnswer: "Vua Quang Trung",
    difficulty: "EASY",
    category: "HISTORY",
    tags: ["Tây Sơn", "Quang Trung"],
    explanation:
      "Hoàng đế Quang Trung (Nguyễn Huệ) thần tốc hành quân ra Bắc đánh tan 29 vạn quân Thanh vào dịp Tết Kỷ Dậu 1789.",
  },
  {
    content:
      "Công trình Vạn Lý Trường Thành của Trung Quốc được bắt đầu xây dựng quy mô lớn dưới thời vị hoàng đế nào?",
    options: ["Tần Thủy Hoàng", "Hán Vũ Đế", "Đường Thái Tông", "Khang Hy"],
    correctAnswer: "Tần Thủy Hoàng",
    difficulty: "HARD",
    category: "HISTORY",
    tags: ["Trung Quốc", "trường thành"],
    explanation:
      "Tần Thủy Hoàng sau khi thống nhất Trung Hoa đã nối các bức tường cổ lại để tạo thành Vạn Lý Trường Thành ngăn giặc Hung Nô.",
  },

  // ==========================================
  // 5. SPORTS (22 câu)
  // ==========================================
  {
    content: "Môn thể thao nào được mệnh danh là 'Môn thể thao vua'?",
    options: ["Bóng đá", "Bóng rổ", "Quần vợt", "Bơi lội"],
    correctAnswer: "Bóng đá",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["bóng đá", "phổ biến"],
    explanation:
      "Bóng đá là môn thể thao được theo dõi và có lượng người hâm mộ đông đảo nhất hành tinh.",
  },
  {
    content:
      "Đội tuyển bóng đá nam quốc gia nào giành nhiều chức vô địch World Cup nhất?",
    options: ["Brazil", "Đức", "Ý", "Argentina"],
    correctAnswer: "Brazil",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["World Cup", "FIFA"],
    explanation:
      "Đội tuyển Brazil đã 5 lần vô địch FIFA World Cup (1958, 1962, 1970, 1994, 2002).",
  },
  {
    content: "Thế vận hội Olympic mùa hè được tổ chức định kỳ mấy năm một lần?",
    options: ["4 năm", "2 năm", "3 năm", "5 năm"],
    correctAnswer: "4 năm",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["Olympic", "thế vận hội"],
    explanation: "Thế vận hội Olympic hiện đại được tổ chức 4 năm một lần.",
  },
  {
    content:
      "Cầu thủ nào đã giành kỷ lục 8 danh hiệu Quả bóng Vàng (Ballon d'Or)?",
    options: ["Lionel Messi", "Cristiano Ronaldo", "Pelé", "Diego Maradona"],
    correctAnswer: "Lionel Messi",
    difficulty: "MEDIUM",
    category: "SPORTS",
    tags: ["cầu thủ", "danh hiệu"],
    explanation:
      "Lionel Messi lập kỷ lục lịch sử với 8 lần đoạt Quả bóng Vàng thế giới.",
  },
  {
    content: "Khoảng cách chuẩn của một cuộc chạy Marathon là bao nhiêu?",
    options: ["42.195 km", "40.000 km", "45.195 km", "50.000 km"],
    correctAnswer: "42.195 km",
    difficulty: "MEDIUM",
    category: "SPORTS",
    tags: ["điền kinh", "marathon"],
    explanation:
      "Cự ly chuẩn của giải chạy marathon quốc tế là 42.195 km (26 dặm 385 yard).",
  },
  {
    content:
      "Trò chơi Esports 'Liên Minh Huyền Thoại' (League of Legends) do công ty nào phát triển?",
    options: ["Riot Games", "Valve", "Blizzard", "Epic Games"],
    correctAnswer: "Riot Games",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["esports", "gaming"],
    explanation:
      "Riot Games phát hành Liên Minh Huyền Thoại năm 2009 và trở thành môn thể thao điện tử hàng đầu.",
  },
  {
    content:
      "Vận động viên điền kinh Usain Bolt mang quốc tịch của quốc gia nào?",
    options: ["Jamaica", "Mỹ", "Anh", "Kenya"],
    correctAnswer: "Jamaica",
    difficulty: "MEDIUM",
    category: "SPORTS",
    tags: ["chạy tốc độ", "huyền thoại"],
    explanation:
      "Tia chớp Usain Bolt là huyền thoại chạy nước rút người Jamaica, giữ kỷ lục thế giới 100m (9.58s).",
  },
  {
    content:
      "Đội tuyển bóng đá nam quốc gia nào đã lên ngôi vô địch World Cup 2022 tại Qatar?",
    options: ["Argentina", "Pháp", "Croatia", "Maroc"],
    correctAnswer: "Argentina",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["World Cup 2022", "vô địch"],
    explanation:
      "Argentina đánh bại Pháp sau loạt luân lưu kịch tính để nâng cao chiếc cúp vàng World Cup 2022.",
  },
  {
    content:
      "Vận động viên bơi lội giành nhiều huy chương vàng Olympic nhất lịch sử (23 HCV) là ai?",
    options: ["Michael Phelps", "Ian Thorpe", "Caeleb Dressel", "Sun Yang"],
    correctAnswer: "Michael Phelps",
    difficulty: "MEDIUM",
    category: "SPORTS",
    tags: ["bơi lội", "Olympic"],
    explanation:
      "Kình ngư người Mỹ Michael Phelps giữ kỷ lục vô tiền khoáng hậu với 28 huy chương Olympic (trong đó có 23 HCV).",
  },
  {
    content:
      "Giải đấu quần vợt danh giá Grand Slam Wimbledon được thi đấu trên loại mặt sân nào?",
    options: ["Sân cỏ", "Sân đất nện", "Sân cứng", "Sân thảm"],
    correctAnswer: "Sân cỏ",
    difficulty: "MEDIUM",
    category: "SPORTS",
    tags: ["quần vợt", "Wimbledon"],
    explanation:
      "Wimbledon tại London (Anh) là giải Grand Slam duy nhất trong năm được tổ chức trên mặt sân cỏ tự nhiên.",
  },
  {
    content:
      "Giải đua xe danh giá hàng đầu thế giới sử dụng xe bánh hở tốc độ cao có tên viết tắt là gì?",
    options: ["F1 (Formula 1)", "NASCAR", "MotoGP", "WRC"],
    correctAnswer: "F1 (Formula 1)",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["đua xe", "tốc độ"],
    explanation:
      "Công thức 1 (Formula 1) là giải đua xe bánh hở cấp cao nhất do Liên đoàn Ô tô Quốc tế (FIA) quản lý.",
  },
  {
    content:
      "Trong một trận đấu bóng rổ tiêu chuẩn của NBA, mỗi đội có bao nhiêu cầu thủ thi đấu trên sân?",
    options: ["5 cầu thủ", "6 cầu thủ", "7 cầu thủ", "4 cầu thủ"],
    correctAnswer: "5 cầu thủ",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["bóng rổ", "NBA"],
    explanation:
      "Mỗi đội bóng rổ trên sân gồm 5 cầu thủ chính thức đảm nhiệm các vị trí PG, SG, SF, PF và C.",
  },
  {
    content:
      "Huyền thoại bóng đá người Brazil được toàn thế giới tôn vinh với danh xưng 'Vua bóng đá' là ai?",
    options: ["Pelé", "Ronaldo Nazário", "Ronaldinho", "Zico"],
    correctAnswer: "Pelé",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["huyền thoại", "Pelé"],
    explanation:
      "Pelé (Edson Arantes do Nascimento) là cầu thủ duy nhất trong lịch sử 3 lần vô địch World Cup.",
  },
  {
    content:
      "Đội tuyển bóng đá nữ quốc gia Việt Nam đã lần đầu tiên tham dự Vòng chung kết World Cup nữ vào năm nào?",
    options: ["2023", "2019", "2015", "2021"],
    correctAnswer: "2023",
    difficulty: "MEDIUM",
    category: "SPORTS",
    tags: ["bóng đá nữ", "Việt Nam"],
    explanation:
      "Các cô gái vàng bóng đá nữ Việt Nam đã làm nên lịch sử khi tranh tài tại FIFA Women's World Cup 2023 ở Úc và New Zealand.",
  },
  {
    content:
      "Môn thể thao bóng bàn (Table Tennis) hiện đại có cội nguồn xuất xứ ban đầu từ quốc gia nào?",
    options: ["Anh", "Trung Quốc", "Thụy Điển", "Đức"],
    correctAnswer: "Anh",
    difficulty: "HARD",
    category: "SPORTS",
    tags: ["bóng bàn", "xuất xứ"],
    explanation:
      "Bóng bàn bắt nguồn từ giới quý tộc thời Victoria ở nước Anh vào cuối thế kỷ XIX như một trò chơi giải trí trong nhà.",
  },
  {
    content:
      "Trong môn bóng đá, chấm phạt đền 11m (penalty) cách vạch khung thành chính xác bao nhiêu mét?",
    options: ["11 mét", "9.15 mét", "12 mét", "10 mét"],
    correctAnswer: "11 mét",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["bóng đá", "luật chơi"],
    explanation:
      "Khoảng cách từ chấm phạt đền đến đường biên ngang khung thành là 11 mét (tương đương 12 yard).",
  },
  {
    content:
      "Môn võ thuật cổ truyền lâu đời của Nhật Bản với hai võ sĩ to lớn đối đầu trong vòng tròn cát là gì?",
    options: ["Sumo", "Karate", "Judo", "Aikido"],
    correctAnswer: "Sumo",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["Sumo", "Nhật Bản"],
    explanation:
      "Sumo là môn đấu vật truyền thống mang đậm nghi lễ Thần đạo và văn hóa nghìn năm của Nhật Bản.",
  },
  {
    content:
      "Huyền thoại bóng rổ số 23 vĩ đại từng dẫn dắt đội Chicago Bulls giành 6 chức vô địch NBA là ai?",
    options: [
      "Michael Jordan",
      "Kobe Bryant",
      "LeBron James",
      "Shaquille O'Neal",
    ],
    correctAnswer: "Michael Jordan",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["bóng rổ", "Michael Jordan"],
    explanation:
      "Michael Jordan được coi là cầu thủ bóng rổ vĩ đại nhất mọi thời đại trong lịch sử NBA.",
  },
  {
    content:
      "Giải bóng đá Ngoại hạng Anh (Premier League) có bao nhiêu câu lạc bộ tranh tài mỗi mùa giải?",
    options: [
      "20 câu lạc bộ",
      "18 câu lạc bộ",
      "22 câu lạc bộ",
      "24 câu lạc bộ",
    ],
    correctAnswer: "20 câu lạc bộ",
    difficulty: "MEDIUM",
    category: "SPORTS",
    tags: ["Ngoại hạng Anh", "bóng đá"],
    explanation:
      "Giải Ngoại hạng Anh quy tụ 20 đội bóng thi đấu vòng tròn 38 vòng đấu để tranh ngôi vô địch.",
  },
  {
    content:
      "Trong môn cờ vua, quân cờ nào có cách di chuyển độc đáo theo quỹ đạo hình chữ L?",
    options: [
      "Quân Mã (Knight)",
      "Quân Xe (Rook)",
      "Quân Tượng (Bishop)",
      "Quân Hậu (Queen)",
    ],
    correctAnswer: "Quân Mã (Knight)",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["cờ vua", "quân cờ"],
    explanation:
      "Quân Mã đi theo hình chữ L (2 ô thẳng và 1 ô ngang hoặc ngược lại) và là quân duy nhất có thể nhảy qua đầu quân khác.",
  },
  {
    content:
      "Tay vợt quần vợt người Tây Ban Nha được mệnh danh là 'Ông vua sân đất nện' với 14 lần vô địch Roland Garros là ai?",
    options: [
      "Rafael Nadal",
      "Roger Federer",
      "Novak Djokovic",
      "Carlos Alcaraz",
    ],
    correctAnswer: "Rafael Nadal",
    difficulty: "MEDIUM",
    category: "SPORTS",
    tags: ["quần vợt", "Nadal"],
    explanation:
      "Rafael Nadal sở hữu kỷ lục vô tiền khoáng hậu tại giải Pháp Mở rộng (Roland Garros) với 14 chức vô địch.",
  },
  {
    content:
      "Đại hội Thể thao Đông Nam Á có tên viết tắt tiếng Anh chính thức là gì?",
    options: ["SEA Games", "Asian Games", "Olympic", "AFF Cup"],
    correctAnswer: "SEA Games",
    difficulty: "EASY",
    category: "SPORTS",
    tags: ["SEA Games", "thể thao"],
    explanation:
      "SEA Games là viết tắt của South East Asian Games, đại hội thể thao khu vực tổ chức 2 năm một lần.",
  },

  // ==========================================
  // 6. CULTURE (22 câu)
  // ==========================================
  {
    content: 'Ai là tác giả của tác phẩm "Truyện Kiều"?',
    options: [
      "Nguyễn Du",
      "Hồ Xuân Hương",
      "Nguyễn Trãi",
      "Bà Huyện Thanh Quan",
    ],
    correctAnswer: "Nguyễn Du",
    difficulty: "HARD",
    category: "CULTURE",
    tags: ["văn học", "kinh điển"],
    explanation:
      "Nguyễn Du (1765-1820) là tác giả của kiệt tác 'Truyện Kiều', một trong những tác phẩm văn học đỉnh cao của Việt Nam.",
  },
  {
    content: "Bức họa nổi tiếng 'Mona Lisa' được vẽ bởi danh họa nào?",
    options: [
      "Leonardo da Vinci",
      "Pablo Picasso",
      "Vincent van Gogh",
      "Michelangelo",
    ],
    correctAnswer: "Leonardo da Vinci",
    difficulty: "EASY",
    category: "CULTURE",
    tags: ["hội họa", "nghệ thuật"],
    explanation:
      "Mona Lisa là kiệt tác hội họa thời Phục hưng của danh họa người Ý Leonardo da Vinci.",
  },
  {
    content: "Trang phục truyền thống nổi tiếng của phụ nữ Việt Nam là gì?",
    options: ["Áo dài", "Kimono", "Hanbok", "Sari"],
    correctAnswer: "Áo dài",
    difficulty: "EASY",
    category: "CULTURE",
    tags: ["trang phục", "truyền thống"],
    explanation:
      "Áo dài là quốc phục và biểu tượng văn hóa đặc trưng của người phụ nữ Việt Nam.",
  },
  {
    content:
      "Nhạc cụ nào sau đây là nhạc cụ truyền thống của Việt Nam chỉ có 1 dây duy nhất?",
    options: ["Đàn bầu", "Đàn tranh", "Đàn nhị", "Đàn tỳ bà"],
    correctAnswer: "Đàn bầu",
    difficulty: "MEDIUM",
    category: "CULTURE",
    tags: ["nhạc cụ", "âm nhạc"],
    explanation:
      "Đàn bầu (độc huyền cầm) chỉ có một dây nhưng tạo ra âm thanh vô cùng thánh thót và truyền cảm.",
  },
  {
    content:
      "Bộ tiểu thuyết nổi tiếng về thế giới phù thủy 'Harry Potter' do ai sáng tác?",
    options: [
      "J.K. Rowling",
      "J.R.R. Tolkien",
      "George R.R. Martin",
      "Stephen King",
    ],
    correctAnswer: "J.K. Rowling",
    difficulty: "EASY",
    category: "CULTURE",
    tags: ["tiểu thuyết", "điện ảnh"],
    explanation:
      "Nhà văn Anh J.K. Rowling là tác giả của bộ truyện kinh điển 7 phần về cậu bé phù thủy Harry Potter.",
  },
  {
    content:
      "Lễ hội cồng chiêng Tây Nguyên của Việt Nam được UNESCO công nhận là di sản gì?",
    options: [
      "Kiệt tác di sản truyền khẩu và phi vật thể nhân loại",
      "Di sản thiên nhiên thế giới",
      "Di sản văn hóa vật thể",
      "Kỳ quan thế giới mới",
    ],
    correctAnswer: "Kiệt tác di sản truyền khẩu và phi vật thể nhân loại",
    difficulty: "HARD",
    category: "CULTURE",
    tags: ["Tây Nguyên", "UNESCO"],
    explanation:
      "Không gian văn hóa Cồng chiêng Tây Nguyên được UNESCO công nhận là Kiệt tác di sản phi vật thể năm 2005.",
  },
  {
    content:
      "Tác phẩm điêu khắc bằng đá cẩm thạch 'Tượng David' tráng lệ là kiệt tác của danh họa, nhà điêu khắc nào?",
    options: ["Michelangelo", "Donatello", "Bernini", "Raphael"],
    correctAnswer: "Michelangelo",
    difficulty: "MEDIUM",
    category: "CULTURE",
    tags: ["điêu khắc", "nghệ thuật"],
    explanation:
      "Tượng David cao hơn 5m được Michelangelo hoàn thành vào năm 1504 tại Florence (Ý).",
  },
  {
    content:
      "Quần thể Di tích Cố đô Huế của Việt Nam được UNESCO công nhận là Di sản Văn hóa Thế giới vào năm nào?",
    options: ["1993", "1999", "2003", "1995"],
    correctAnswer: "1993",
    difficulty: "HARD",
    category: "CULTURE",
    tags: ["Huế", "di sản"],
    explanation:
      "Cố đô Huế là di sản đầu tiên của Việt Nam được UNESCO vinh danh là Di sản Văn hóa Thế giới năm 1993.",
  },
  {
    content:
      "Thể loại kịch hát truyền thống đặc sắc khởi nguồn từ vùng đất Nam Bộ Việt Nam là gì?",
    options: ["Cải lương", "Hát Chèo", "Hát Tuồng", "Hát Xoan"],
    correctAnswer: "Cải lương",
    difficulty: "EASY",
    category: "CULTURE",
    tags: ["âm nhạc", "Nam Bộ"],
    explanation:
      "Cải lương hình thành vào đầu thế kỷ XX dựa trên nền tảng đờn ca tài tử Nam Bộ.",
  },
  {
    content:
      "Lễ hội ngắm hoa anh đào truyền thống (Hanami) là nét văn hóa đặc trưng của quốc gia nào?",
    options: ["Nhật Bản", "Hàn Quốc", "Đài Loan", "Trung Quốc"],
    correctAnswer: "Nhật Bản",
    difficulty: "EASY",
    category: "CULTURE",
    tags: ["hoa anh đào", "lễ hội"],
    explanation:
      "Hanami là phong tục thưởng hoa anh đào nở rộ vào mùa xuân lâu đời của người dân Nhật Bản.",
  },
  {
    content:
      "Nhạc sĩ thiên tài nào đã sáng tác ca khúc 'Tiến quân ca' (Quốc ca nước Cộng hòa Xã hội Chủ nghĩa Việt Nam)?",
    options: ["Văn Cao", "Trịnh Công Sơn", "Phạm Tuyên", "Hoàng Việt"],
    correctAnswer: "Văn Cao",
    difficulty: "EASY",
    category: "CULTURE",
    tags: ["Quốc ca", "nhạc sĩ"],
    explanation:
      "Nhạc sĩ Văn Cao sáng tác ca khúc Tiến quân ca vào năm 1944 tại Hà Nội.",
  },
  {
    content:
      "Tác phẩm tiểu thuyết chương hồi kinh điển 'Tam Quốc Diễn Nghĩa' của Trung Hoa do ai chấp bút?",
    options: ["La Quán Trung", "Thi Nại Am", "Ngô Thừa Ân", "Tào Tuyết Cần"],
    correctAnswer: "La Quán Trung",
    difficulty: "MEDIUM",
    category: "CULTURE",
    tags: ["văn học", "Trung Hoa"],
    explanation:
      "La Quán Trung sống vào cuối thời Nguyên đầu thời Minh là tác giả bộ tiểu thuyết Tam Quốc Diễn Nghĩa.",
  },
  {
    content:
      "Giải thưởng điện ảnh danh giá và quyền lực nhất thế giới trao tặng bức tượng vàng có tên gọi quen thuộc là gì?",
    options: ["Giải Oscar", "Giải Emmy", "Giải Grammy", "Giải Quả Cầu Vàng"],
    correctAnswer: "Giải Oscar",
    difficulty: "EASY",
    category: "CULTURE",
    tags: ["điện ảnh", "Oscar"],
    explanation:
      "Giải thưởng Viện Hàn lâm (Oscar) vinh danh những thành tựu xuất sắc trong ngành điện ảnh toàn cầu.",
  },
  {
    content:
      "Vở nhạc kịch kinh điển 'Những người khốn khổ' (Les Misérables) dựa trên tiểu thuyết của đại văn hào nào?",
    options: [
      "Victor Hugo",
      "Alexandre Dumas",
      "Honoré de Balzac",
      "Gustave Flaubert",
    ],
    correctAnswer: "Victor Hugo",
    difficulty: "MEDIUM",
    category: "CULTURE",
    tags: ["văn học Pháp", "Victor Hugo"],
    explanation:
      "Đại văn hào Victor Hugo xuất bản tiểu thuyết Những người khốn khổ vào năm 1862.",
  },
  {
    content:
      "Nghệ thuật múa rối nước độc đáo của Việt Nam có nguồn gốc xuất xứ từ nền văn minh nông nghiệp của vùng nào?",
    options: [
      "Đồng bằng Bắc Bộ",
      "Đồng bằng sông Cửu Long",
      "Tây Nguyên",
      "Duyên hải Miền Trung",
    ],
    correctAnswer: "Đồng bằng Bắc Bộ",
    difficulty: "MEDIUM",
    category: "CULTURE",
    tags: ["rối nước", "dân gian"],
    explanation:
      "Múa rối nước là loại hình nghệ thuật sân khấu dân gian độc nhất vô nhị gắn liền với đồng ruộng châu thổ sông Hồng.",
  },
  {
    content:
      "Lễ hội hoa đăng thả đèn lồng lung linh 'Loy Krathong' diễn ra hàng năm tại đất nước nào?",
    options: ["Thái Lan", "Lào", "Myanmar", "Ấn Độ"],
    correctAnswer: "Thái Lan",
    difficulty: "MEDIUM",
    category: "CULTURE",
    tags: ["lễ hội", "Thái Lan"],
    explanation:
      "Loy Krathong là lễ hội truyền thống thả hoa đăng trên sông để tỏ lòng tôn kính Nữ thần Nước của người Thái.",
  },
  {
    content:
      "Bức tranh kiệt tác 'Đêm đầy sao' (The Starry Night) với những vòng xoáy ánh sáng huyền ảo là tác phẩm của ai?",
    options: [
      "Vincent van Gogh",
      "Claude Monet",
      "Paul Gauguin",
      "Edvard Munch",
    ],
    correctAnswer: "Vincent van Gogh",
    difficulty: "MEDIUM",
    category: "CULTURE",
    tags: ["hội họa", "Van Gogh"],
    explanation:
      "Vincent van Gogh vẽ bức Đêm đầy sao vào tháng 6 năm 1889 khi đang điều trị tại Saint-Rémy-de-Provence.",
  },
  {
    content:
      "Thể loại dân ca cổ truyền ngọt ngào ở vùng Kinh Bắc (Bắc Ninh - Bắc Giang) được UNESCO vinh danh là gì?",
    options: ["Dân ca Quan họ", "Hát Ca trù", "Hát Đúm", "Hát Chầu văn"],
    correctAnswer: "Dân ca Quan họ",
    difficulty: "EASY",
    category: "CULTURE",
    tags: ["Quan họ", "Bắc Ninh"],
    explanation:
      "Dân ca Quan họ Bắc Ninh là Di sản văn hóa phi vật thể đại diện của nhân loại được UNESCO công nhận năm 2009.",
  },
  {
    content:
      "Nhà văn Đan Mạch nổi tiếng toàn thế giới với những câu chuyện cổ tích như 'Nàng tiên cá', 'Chú vịt con xấu xí' là ai?",
    options: [
      "Hans Christian Andersen",
      "Anh em nhà Grimm",
      "Charles Perrault",
      "Lewis Carroll",
    ],
    correctAnswer: "Hans Christian Andersen",
    difficulty: "EASY",
    category: "CULTURE",
    tags: ["truyện cổ tích", "Andersen"],
    explanation:
      "Andersen là ông hoàng truyện cổ tích thế giới với hàng trăm tác phẩm gắn liền với tuổi thơ nhân loại.",
  },
  {
    content:
      "Công trình Nhà thờ Đức Bà Paris (Pháp) được xây dựng theo phong cách kiến trúc nghệ thuật tiêu biểu nào?",
    options: ["Gothic", "Baroque", "Romanesque", "Phục hưng"],
    correctAnswer: "Gothic",
    difficulty: "HARD",
    category: "CULTURE",
    tags: ["kiến trúc", "Paris"],
    explanation:
      "Nhà thờ Đức Bà Paris là một trong những ví dụ trác tuyệt nhất của kiến trúc Gothic thời Trung Cổ.",
  },
  {
    content:
      "Phim hoạt hình và phong cách vẽ truyện tranh đặc trưng của đất nước Nhật Bản thường được gọi chung là gì?",
    options: ["Anime & Manga", "Cartoon", "Comics", "Webtoon"],
    correctAnswer: "Anime & Manga",
    difficulty: "EASY",
    category: "CULTURE",
    tags: ["Anime", "Manga"],
    explanation:
      "Anime (hoạt hình) và Manga (truyện tranh) là nét văn hóa đại chúng toàn cầu độc đáo của xứ sở mặt trời mọc.",
  },
  {
    content:
      "Nhạc cụ cổ điển phương Tây nào thường được mệnh danh trang trọng là 'Vua của các loại nhạc cụ'?",
    options: ["Đàn Piano", "Đàn Violin", "Đàn Guitar", "Kèn Saxophone"],
    correctAnswer: "Đàn Piano",
    difficulty: "MEDIUM",
    category: "CULTURE",
    tags: ["nhạc cụ", "Piano"],
    explanation:
      "Piano (dương cầm) có âm vực rộng nhất và khả năng biểu đạt phong phú nhất trong các nhạc cụ phương Tây.",
  },

  // ==========================================
  // 7. LOGIC (22 câu)
  // ==========================================
  {
    content: "1 + 1 = ?",
    options: ["1", "2", "3", "4"],
    correctAnswer: "2",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["toán học", "cơ bản"],
    explanation: "Phép cộng cơ bản: 1 + 1 = 2.",
  },
  {
    content: "Nếu hôm qua là thứ Hai, thì ngày mai là thứ mấy?",
    options: ["Thứ Tư", "Thứ Ba", "Thứ Năm", "Chủ Nhật"],
    correctAnswer: "Thứ Tư",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["thời gian", "suy luận"],
    explanation:
      "Hôm qua là thứ Hai -> Hôm nay là thứ Ba -> Ngày mai là thứ Tư.",
  },
  {
    content:
      "Trong một cuộc đua, nếu bạn vượt qua người đang chạy ở vị trí thứ hai, bạn đang ở vị trí thứ mấy?",
    options: ["Thứ hai", "Thứ nhất", "Thứ ba", "Thứ tư"],
    correctAnswer: "Thứ hai",
    difficulty: "MEDIUM",
    category: "LOGIC",
    tags: ["đố vui", "tư duy"],
    explanation:
      "Khi bạn vượt qua người thứ hai, bạn chiếm lấy vị trí thứ hai của người đó.",
  },
  {
    content:
      "Số tiếp theo trong dãy số quy luật: 2, 4, 8, 16, ... là bao nhiêu?",
    options: ["32", "24", "20", "64"],
    correctAnswer: "32",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["dãy số", "quy luật"],
    explanation:
      "Mỗi số trong dãy bằng số liền trước nhân với 2 (2 x 2 = 4, 4 x 2 = 8, 8 x 2 = 16, 16 x 2 = 32).",
  },
  {
    content:
      "Có một con vịt đi trước hai con vịt, một con vịt đi sau hai con vịt, một con vịt đi giữa hai con vịt. Hỏi có ít nhất bao nhiêu con vịt?",
    options: ["3 con", "4 con", "5 con", "6 con"],
    correctAnswer: "3 con",
    difficulty: "MEDIUM",
    category: "LOGIC",
    tags: ["câu đố", "tối ưu"],
    explanation:
      "Chỉ cần 3 con vịt đi nối đuôi nhau thành một hàng dọc là thỏa mãn toàn bộ mô tả.",
  },
  {
    content: "Hình nào sau đây có tổng các góc trong luôn bằng 180 độ?",
    options: ["Tam giác", "Tứ giác", "Hình chữ nhật", "Ngũ giác"],
    correctAnswer: "Tam giác",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["hình học", "toán"],
    explanation:
      "Định lý hình học phẳng: Tổng ba góc trong của bất kỳ tam giác nào luôn bằng 180 độ.",
  },
  {
    content: "Tìm số nguyên tố chẵn duy nhất trong tập hợp số nguyên dương?",
    options: ["2", "0", "4", "6"],
    correctAnswer: "2",
    difficulty: "MEDIUM",
    category: "LOGIC",
    tags: ["số học", "nguyên tố"],
    explanation: "Số 2 là số nguyên tố duy nhất chia hết cho 2 và là số chẵn.",
  },
  {
    content: "Số nào nhân với bất kỳ số nào cũng cho kết quả bằng 0?",
    options: ["Số 0", "Số 1", "Số -1", "Số 10"],
    correctAnswer: "Số 0",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["số học", "nhân"],
    explanation:
      "Quy tắc toán học cơ bản: Mọi số nhân với 0 đều bằng 0 (x * 0 = 0).",
  },
  {
    content:
      "Nếu 5 người thợ may 5 chiếc áo trong 5 phút, thì 100 người thợ may 100 chiếc áo trong bao nhiêu phút?",
    options: ["5 phút", "100 phút", "20 phút", "1 phút"],
    correctAnswer: "5 phút",
    difficulty: "MEDIUM",
    category: "LOGIC",
    tags: ["bài toán", "năng suất"],
    explanation:
      "Mỗi người thợ mất 5 phút để may xong 1 chiếc áo, do đó 100 người thợ may đồng thời 100 chiếc áo cũng chỉ mất 5 phút.",
  },
  {
    content:
      "Một hình chữ nhật có chiều dài 8cm và chiều rộng 5cm. Diện tích của hình chữ nhật đó là bao nhiêu?",
    options: ["40 cm²", "26 cm²", "13 cm²", "45 cm²"],
    correctAnswer: "40 cm²",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["diện tích", "hình học"],
    explanation:
      "Diện tích hình chữ nhật = Chiều dài x Chiều rộng = 8 x 5 = 40 cm².",
  },
  {
    content: "Căn bậc hai số học của số 144 là bao nhiêu?",
    options: ["12", "14", "16", "11"],
    correctAnswer: "12",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["căn bậc hai", "toán học"],
    explanation: "12 x 12 = 144, do đó căn bậc hai của 144 là 12.",
  },
  {
    content:
      "Trong bảng chữ cái tiếng Anh chuẩn (26 chữ), chữ cái nào đứng liền trước chữ cái 'M'?",
    options: ["L", "N", "K", "O"],
    correctAnswer: "L",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["chữ cái", "tiếng Anh"],
    explanation:
      "Thứ tự bảng chữ cái: ... J, K, L, M, N, O ... Chữ đứng liền trước M là L.",
  },
  {
    content:
      "Một người cha có 4 người con trai. Mỗi người con trai lại có đúng một người em gái. Hỏi người cha có tất cả bao nhiêu người con?",
    options: ["5 người con", "8 người con", "4 người con", "9 người con"],
    correctAnswer: "5 người con",
    difficulty: "MEDIUM",
    category: "LOGIC",
    tags: ["đố mẹo", "gia đình"],
    explanation:
      "Gia đình gồm 4 người con trai và 1 người con gái út (người em gái chung của cả 4 anh em trai), tổng cộng là 5 người con.",
  },
  {
    content:
      "Chữ số La Mã 'XIV' tương ứng với số tự nhiên nào trong hệ thập phân?",
    options: ["14", "16", "24", "11"],
    correctAnswer: "14",
    difficulty: "MEDIUM",
    category: "LOGIC",
    tags: ["số La Mã", "toán học"],
    explanation: "Trong số La Mã: X = 10, IV = 4. Do đó XIV = 10 + 4 = 14.",
  },
  {
    content:
      "Con số tiếp theo trong dãy số Fibonacci kinh điển: 1, 1, 2, 3, 5, 8, ... là bao nhiêu?",
    options: ["13", "11", "15", "16"],
    correctAnswer: "13",
    difficulty: "MEDIUM",
    category: "LOGIC",
    tags: ["Fibonacci", "dãy số"],
    explanation:
      "Dãy Fibonacci có quy tắc: mỗi số bằng tổng hai số liền trước nó (5 + 8 = 13).",
  },
  {
    content:
      "Nếu bạn có một chiếc đồng hồ cát 3 phút và một chiếc 5 phút, khi đồng hồ 5 phút chảy hết thì đã trôi qua bao nhiêu thời gian?",
    options: ["5 phút", "8 phút", "2 phút", "3 phút"],
    correctAnswer: "5 phút",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["thời gian", "đồng hồ cát"],
    explanation:
      "Chiếc đồng hồ cát 5 phút luôn đo chính xác khoảng thời gian là 5 phút.",
  },
  {
    content:
      "Tính giá trị của biểu thức toán học: 10 - 2 x 3 + 4 theo thứ tự ưu tiên phép tính?",
    options: ["8", "28", "2", "12"],
    correctAnswer: "8",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["thứ tự phép tính", "toán"],
    explanation:
      "Nhân chia trước, cộng trừ sau: 10 - (2 x 3) + 4 = 10 - 6 + 4 = 4 + 4 = 8.",
  },
  {
    content:
      "Một tá trứng gà theo định lượng thông thường ở Việt Nam gồm bao nhiêu quả?",
    options: ["12 quả", "10 quả", "20 quả", "6 quả"],
    correctAnswer: "12 quả",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["đơn vị đo", "tá"],
    explanation:
      "Một tá là đơn vị đếm truyền thống quy ước gồm đúng 12 đơn vị.",
  },
  {
    content:
      "Trong một năm dương lịch thông thường, có tất cả bao nhiêu tháng có 31 ngày?",
    options: ["7 tháng", "6 tháng", "5 tháng", "8 tháng"],
    correctAnswer: "7 tháng",
    difficulty: "MEDIUM",
    category: "LOGIC",
    tags: ["lịch", "tháng"],
    explanation:
      "Các tháng có 31 ngày là: Tháng 1, 3, 5, 7, 8, 10 và 12 (tổng cộng 7 tháng).",
  },
  {
    content:
      "Tìm hai số nguyên dương biết tổng của chúng bằng 100 và hiệu của chúng bằng 20?",
    options: ["60 và 40", "70 và 30", "55 và 45", "80 và 20"],
    correctAnswer: "60 và 40",
    difficulty: "MEDIUM",
    category: "LOGIC",
    tags: ["toán tìm số", "tổng hiệu"],
    explanation: "Số lớn = (100 + 20) / 2 = 60; Số bé = 100 - 60 = 40.",
  },
  {
    content:
      "Một chiếc xe bus có 10 hành khách. Tại bến A có 3 người xuống và 5 người lên. Tại bến B có 2 người xuống. Hỏi xe bus hiện còn bao nhiêu khách?",
    options: [
      "10 hành khách",
      "8 hành khách",
      "12 hành khách",
      "15 hành khách",
    ],
    correctAnswer: "10 hành khách",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["tính nhẩm", "hành khách"],
    explanation: "10 - 3 + 5 - 2 = 10 hành khách.",
  },
  {
    content:
      "Một hình tròn hoàn hảo có bao nhiêu trục đối xứng đi qua tâm của nó?",
    options: ["Vô số", "1", "2", "4"],
    correctAnswer: "Vô số",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["hình học", "đối xứng"],
    explanation:
      "Mọi đường thẳng đi qua tâm của hình tròn đều là trục đối xứng của hình tròn đó, do đó có vô số trục đối xứng.",
  },

  // ==========================================
  // 8. GENERAL (22 câu)
  // ==========================================
  {
    content: 'Con vật nào được gọi là "chúa tể rừng xanh"?',
    options: ["Hổ", "Sư tử", "Voi", "Gấu"],
    correctAnswer: "Sư tử",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["động vật", "thành ngữ"],
    explanation:
      "Sư tử thường được gọi là 'chúa tể rừng xanh' do sức mạnh và vẻ oai nghiêm của chúng.",
  },
  {
    content: "Loài chim nào lớn nhất hành tinh hiện nay và không biết bay?",
    options: ["Đà điểu", "Chim cánh cụt", "Đại bàng", "Thiên nga"],
    correctAnswer: "Đà điểu",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["thế giới động vật", "loài chim"],
    explanation:
      "Đà điểu châu Phi là loài chim có kích thước và cân nặng lớn nhất còn tồn tại.",
  },
  {
    content: "Đèn giao thông đường bộ thông thường có những màu nào?",
    options: [
      "Đỏ, Vàng, Xanh lá",
      "Đỏ, Xanh dương, Vàng",
      "Tím, Vàng, Xanh lá",
      "Cam, Xanh lá, Đỏ",
    ],
    correctAnswer: "Đỏ, Vàng, Xanh lá",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["giao thông", "đời sống"],
    explanation:
      "Quy chuẩn quốc tế đèn giao thông gồm 3 màu: Đỏ (dừng lại), Vàng (giảm tốc) và Xanh lá (được đi).",
  },
  {
    content:
      "Đâu là loài động vật có vú duy nhất có khả năng bay lượn thực sự?",
    options: ["Dơi", "Sóc bay", "Cú mèo", "Vượn cáo"],
    correctAnswer: "Dơi",
    difficulty: "MEDIUM",
    category: "GENERAL",
    tags: ["sinh học", "động vật có vú"],
    explanation:
      "Dơi là loài động vật có vú duy nhất có cấu tạo cánh hoàn chỉnh cho phép bay lượn.",
  },
  {
    content:
      "Đồng tiền chung của đa số các quốc gia thành viên Liên minh Châu Âu (EU) là gì?",
    options: ["Euro", "Bảng Anh", "Đô la", "Franc"],
    correctAnswer: "Euro",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["tiền tệ", "châu Âu"],
    explanation:
      "Đồng Euro (€) là đơn vị tiền tệ chính thức của khu vực đồng tiền chung châu Âu (Eurozone).",
  },
  {
    content: "Một năm nhuận theo Dương lịch có bao nhiêu ngày?",
    options: ["366 ngày", "365 ngày", "364 ngày", "367 ngày"],
    correctAnswer: "366 ngày",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["lịch pháp", "thời gian"],
    explanation: "Năm nhuận có thêm ngày 29 tháng 2 nên tổng cộng có 366 ngày.",
  },
  {
    content:
      "Mật ong tự nhiên có thể để được bao lâu mà không bị ôi thiu nếu bảo quản đúng cách?",
    options: ["Hàng ngàn năm", "1 năm", "6 tháng", "5 năm"],
    correctAnswer: "Hàng ngàn năm",
    difficulty: "HARD",
    category: "GENERAL",
    tags: ["thực phẩm", "khoa học đời sống"],
    explanation:
      "Nhờ độ ẩm cực thấp và tính axit tự nhiên, mật ong nguyên chất gần như không bao giờ bị hỏng (đã tìm thấy mật ong còn tốt trong lăng mộ Ai Cập cổ).",
  },
  {
    content:
      "Loài động vật có kích thước và khối lượng lớn nhất từng được ghi nhận trong lịch sử Trái Đất là gì?",
    options: [
      "Cá voi xanh",
      "Khủng long bạo chúa T-Rex",
      "Voi ma mút",
      "Cá mập Megalodon",
    ],
    correctAnswer: "Cá voi xanh",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["sinh vật", "kỷ lục"],
    explanation:
      "Cá voi xanh có thể dài hơn 30 mét và nặng tới gần 200 tấn, vượt qua cả những loài khủng long lớn nhất.",
  },
  {
    content:
      "Quốc hoa chính thức được tôn vinh của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam là loài hoa nào?",
    options: ["Hoa Sen", "Hoa Mai", "Hoa Đào", "Hoa Hướng Dương"],
    correctAnswer: "Hoa Sen",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["quốc hoa", "Việt Nam"],
    explanation:
      "Hoa Sen tượng trưng cho vẻ đẹp thuần khiết, thanh cao và phẩm chất kiên cường của con người Việt Nam.",
  },
  {
    content:
      "Khi pha trộn màu vàng với màu xanh lam (xanh dương) theo tỷ lệ phù hợp, chúng ta sẽ thu được màu gì?",
    options: ["Màu xanh lá cây", "Màu tím", "Màu cam", "Màu nâu"],
    correctAnswer: "Màu xanh lá cây",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["màu sắc", "hội họa"],
    explanation:
      "Theo nguyên lý phối màu cơ bản (màu trừ), Vàng + Xanh lam = Xanh lá cây.",
  },
  {
    content:
      "Thức ăn chính chiếm hơn 99% khẩu phần ăn hàng ngày của loài gấu trúc khổng lồ là gì?",
    options: ["Cây tre, trúc", "Thịt cá", "Quả mọng", "Cỏ non"],
    correctAnswer: "Cây tre, trúc",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["gấu trúc", "động vật"],
    explanation:
      "Mặc dù thuộc bộ ăn thịt, gấu trúc khổng lồ đã tiến hóa để thích nghi với thức ăn hầu như chỉ là tre trúc.",
  },
  {
    content:
      "Tổ chức Y tế Thế giới trực thuộc Liên Hợp Quốc có tên viết tắt tiếng Anh là gì?",
    options: ["WHO", "UNESCO", "UNICEF", "WTO"],
    correctAnswer: "WHO",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["y tế", "tổ chức"],
    explanation:
      "WHO là viết tắt của World Health Organization (Tổ chức Y tế Thế giới).",
  },
  {
    content:
      "Một người trưởng thành có hàm răng vĩnh viễn đầy đủ (bao gồm 4 răng khôn) có bao nhiêu chiếc răng?",
    options: ["32 chiếc", "28 chiếc", "30 chiếc", "36 chiếc"],
    correctAnswer: "32 chiếc",
    difficulty: "MEDIUM",
    category: "GENERAL",
    tags: ["con người", "nha khoa"],
    explanation:
      "Bộ răng vĩnh viễn chuẩn của người trưởng thành gồm 32 chiếc chia đều cho hai hàm trên và dưới.",
  },
  {
    content:
      "Quốc kỳ của đất nước nào chỉ có hai màu đỏ - trắng với biểu tượng một chiếc lá phong ở trung tâm?",
    options: ["Canada", "Thụy Sĩ", "Nhật Bản", "Thổ Nhĩ Kỳ"],
    correctAnswer: "Canada",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["quốc kỳ", "Canada"],
    explanation:
      "Lá phong đỏ (Maple Leaf) là biểu tượng quốc gia thiêng liêng trên quốc kỳ của Canada.",
  },
  {
    content:
      "Kim loại nào sau đây có khả năng dẫn điện và dẫn nhiệt tốt nhất trong điều kiện thường?",
    options: ["Bạc (Ag)", "Đồng (Cu)", "Vàng (Au)", "Nhôm (Al)"],
    correctAnswer: "Bạc (Ag)",
    difficulty: "MEDIUM",
    category: "GENERAL",
    tags: ["vật liệu", "kim loại"],
    explanation:
      "Bạc có độ dẫn điện và dẫn nhiệt cao nhất trong các kim loại, tiếp theo sau là Đồng và Vàng.",
  },
  {
    content:
      "Loài cây thân cỏ nào là biểu tượng mộc mạc cho làng quê và sự bất khuất của dân tộc Việt Nam?",
    options: ["Cây tre", "Cây bàng", "Cây đa", "Cây cau"],
    correctAnswer: "Cây tre",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["văn hóa", "cây tre"],
    explanation:
      "Cây tre kiên cường mộc mạc gắn bó thủy chung với người dân Việt Nam qua hàng ngàn năm dựng nước và giữ nước.",
  },
  {
    content:
      "Đơn vị tiền tệ chính thức của đất nước Nhật Bản có tên gọi là gì?",
    options: ["Yên (JPY)", "Won (KRW)", "Nhân dân tệ (CNY)", "Kip (LAK)"],
    correctAnswer: "Yên (JPY)",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["tiền tệ", "Nhật Bản"],
    explanation:
      "Đồng Yên (¥) là đơn vị tiền tệ chính thức của Nhật Bản được đưa vào sử dụng từ năm 1871.",
  },
  {
    content:
      "Thời gian để Trái Đất tự quay hết một vòng quanh trục của nó xấp xỉ bằng bao nhiêu?",
    options: [
      "24 giờ (1 ngày)",
      "12 giờ",
      "365 ngày (1 năm)",
      "30 ngày (1 tháng)",
    ],
    correctAnswer: "24 giờ (1 ngày)",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["Trái Đất", "thời gian"],
    explanation:
      "Trái Đất tự quay quanh trục từ Tây sang Đông mất 23 giờ 56 phút 4 giây (làm tròn là 24 giờ / 1 ngày đêm).",
  },
  {
    content:
      "Loài bò sát nào nổi tiếng với khả năng tự thay đổi màu sắc của da để ngụy trang và biểu lộ cảm xúc?",
    options: ["Tắc kè hoa", "Kỳ đà", "Thằn lằn", "Rắn mối"],
    correctAnswer: "Tắc kè hoa",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["bò sát", "tự nhiên"],
    explanation:
      "Tắc kè hoa (Chameleon) có các tế bào sắc tố đặc biệt dưới da giúp chúng đổi màu linh hoạt.",
  },
  {
    content:
      "Món ăn truyền thống của Việt Nam gồm bánh tráng cuốn tôm thịt bún và rau sống chấm nước sốt là gì?",
    options: ["Gỏi cuốn", "Bánh chưng", "Phở bò", "Bánh xèo"],
    correctAnswer: "Gỏi cuốn",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["ẩm thực", "Việt Nam"],
    explanation:
      "Gỏi cuốn là món ăn thanh mát nổi tiếng thế giới của ẩm thực Việt Nam (Vietnamese Spring Rolls).",
  },
  {
    content:
      "Dải quang phổ ánh sáng nhìn thấy của cầu vồng gồm bao nhiêu màu sắc cơ bản?",
    options: ["7 màu", "5 màu", "6 màu", "8 màu"],
    correctAnswer: "7 màu",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["cầu vồng", "màu sắc"],
    explanation:
      "7 màu cơ bản theo thứ tự: Đỏ, Da cam, Vàng, Lục, Lam, Chàm, Tím.",
  },
  {
    content:
      "Đơn vị Decibel (dB) được sử dụng để đo lường đại lượng vật lý nào trong đời sống?",
    options: [
      "Cường độ âm thanh",
      "Độ sáng quang học",
      "Áp suất khí quyển",
      "Tần số vô tuyến",
    ],
    correctAnswer: "Cường độ âm thanh",
    difficulty: "MEDIUM",
    category: "GENERAL",
    tags: ["vật lý", "âm thanh"],
    explanation:
      "Decibel (dB) là đơn vị đo mức cường độ âm thanh so với ngưỡng nghe của tai người.",
  },
];

/**
 * Normalizes a string for comparison (trim, lowercase, remove extra spaces)
 * @param str The string to normalize
 * @returns The normalized string
 */
export function normalizeString(str: string): string {
  return str.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Validates that correctAnswer is one of the options
 * @param question The question to validate
 * @throws Error if correctAnswer is not in options
 */
function validateQuestion(question: Question): void {
  // Reject empty question content
  if (!question.content || normalizeString(question.content).length === 0) {
    throw new Error(`Invalid question: Question content cannot be empty.`);
  }

  // Ensure 4 options
  if (question.options.length !== 4) {
    throw new Error(
      `Invalid question: "${question.content}". Expected 4 options, got ${question.options.length}`,
    );
  }

  // Reject empty options
  for (const option of question.options) {
    if (!option || normalizeString(option).length === 0) {
      throw new Error(
        `Invalid question: "${question.content}". Option cannot be empty.`,
      );
    }
  }

  // Check that correctAnswer is one of the options
  if (!question.options.includes(question.correctAnswer)) {
    throw new Error(
      `Invalid question: "${question.content}". Correct answer "${question.correctAnswer}" is not in options: [${question.options.join(", ")}]`,
    );
  }

  // Ensure no duplicate options (after normalization)
  const normalizedOptions = question.options.map((opt) => normalizeString(opt));
  const uniqueOptions = new Set(normalizedOptions);
  if (uniqueOptions.size !== question.options.length) {
    throw new Error(
      `Invalid question: "${question.content}". Options contain duplicates: [${question.options.join(", ")}]`,
    );
  }

  // Ensure difficulty is valid
  if (!["EASY", "MEDIUM", "HARD"].includes(question.difficulty)) {
    throw new Error(
      `Invalid question: Invalid difficulty "${question.difficulty}" for question "${question.content}"`,
    );
  }

  // Ensure category is valid
  if (
    ![
      "GENERAL",
      "SCIENCE",
      "HISTORY",
      "GEOGRAPHY",
      "TECHNOLOGY",
      "SPORTS",
      "CULTURE",
      "LOGIC",
    ].includes(question.category)
  ) {
    throw new Error(
      `Invalid question: Missing category for question "${question.content}"`,
    );
  }

  // Check tags after normalization if they exist
  if (question.tags) {
    const normalizedTags = question.tags.map(normalizeString);

    // Ensure no normalized tag is empty
    const emptyTagIndex = normalizedTags.findIndex((tag) => tag === "");
    if (emptyTagIndex !== -1) {
      throw new Error(
        `Invalid question: Empty tag found in question "${question.content}". Offending tag: "${question.tags[emptyTagIndex]}"`,
      );
    }

    // Ensure no duplicates in normalized tags
    const uniqueTags = new Set(normalizedTags);
    if (uniqueTags.size !== question.tags.length) {
      // Find duplicates to list them in the error
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const tag of normalizedTags) {
        if (seen.has(tag)) {
          duplicates.add(tag);
        }
        seen.add(tag);
      }
      throw new Error(
        `Invalid question: Duplicate tags [${Array.from(duplicates)
          .map((d) => `"${d}"`)
          .join(
            ", ",
          )}] found in question "${question.content}". Original tags: [${question.tags.map((t) => `"${t}"`).join(", ")}]`,
      );
    }
  }
}

/**
 * Validates all questions in the seed data
 * @param questions The array of questions to validate, defaults to questionSeeds
 */
export function validateQuestions(questions: Question[] = questionSeeds): void {
  // Validate each question individually
  questions.forEach(validateQuestion);

  // Check for duplicate questions by normalized content
  const questionContents = new Set<string>();
  for (const question of questions) {
    const normalizedContent = normalizeString(question.content);
    if (questionContents.has(normalizedContent)) {
      throw new Error(`Duplicate question found: "${question.content}"`);
    }
    questionContents.add(normalizedContent);
  }
}

// Validate all questions on module load
validateQuestions();
