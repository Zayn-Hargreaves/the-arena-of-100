export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="text-center space-y-8">
        {/* Logo & Title */}
        <div className="space-y-4">
          <h1 className="text-6xl font-bold text-arena-primary animate-bounce-in">
            🏟️ Arena of 100
          </h1>
          <p className="text-xl text-gray-400">
            Game Đấu Trường 100 - Battle Royale Quiz
          </p>
        </div>

        {/* Main Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button className="btn-primary text-lg">
            🎮 Tạo Phòng
          </button>
          <button className="btn-secondary text-lg">
            🚪 Vào Phòng
          </button>
        </div>

        {/* Quick Match */}
        <div className="pt-8">
          <button className="btn-danger text-lg w-full sm:w-auto">
            ⚡ Tìm Trận Nhanh
          </button>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-12 max-w-4xl mx-auto">
          <div className="card text-center">
            <div className="text-4xl mb-4">👥</div>
            <h3 className="text-xl font-bold text-white mb-2">100 Người Chơi</h3>
            <p className="text-gray-400">
              Tham gia cùng 99 người chơi khác trong trận đấu sinh tử
            </p>
          </div>
          <div className="card text-center">
            <div className="text-4xl mb-4">❓</div>
            <h3 className="text-xl font-bold text-white mb-2">Câu Hỏi Nhanh</h3>
            <p className="text-gray-400">
              Trả lời đúng để sống sót, sai là bị loại ngay lập tức
            </p>
          </div>
          <div className="card text-center">
            <div className="text-4xl mb-4">🏆</div>
            <h3 className="text-xl font-bold text-white mb-2">Người Chiến Thắng</h3>
            <p className="text-gray-400">
              Người cuối cùng sống sót sẽ trở thành nhà vô địch
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}