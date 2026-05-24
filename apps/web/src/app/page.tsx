import Link from "next/link";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="text-center space-y-8">
        {/* Logo & Title */}
        <div className="space-y-4">
          <h1 className="text-5xl md:text-6xl font-display text-primary animate-bounce-in">
            🏟️ Arena of 100
          </h1>
          <p className="text-xl text-on-background/70">
            Game Đấu Trường 100 - Battle Royale Quiz
          </p>
        </div>

        {/* Main Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button variant="primary" size="lg">
            🎮 Tạo Phòng
          </Button>
          <Button variant="secondary" size="lg">
            🚪 Vào Phòng
          </Button>
        </div>

        {/* Quick Match */}
        <div className="pt-8">
          <Button variant="danger" size="lg">
            ⚡ Tìm Trận Nhanh
          </Button>
        </div>

        {/* Test Components Link */}
        <div className="pt-4">
          <Link
            href="/test-components"
            className="text-secondary-fixed hover:text-secondary-fixed/80 underline"
          >
            🧪 Test Components
          </Link>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-12 max-w-4xl mx-auto">
          <GlassPanel>
            <div className="text-4xl mb-4">👥</div>
            <h3 className="text-xl font-display text-primary mb-2">
              100 Người Chơi
            </h3>
            <p className="text-on-background/70">
              Tham gia cùng 99 người chơi khác trong trận đấu sinh tử
            </p>
          </GlassPanel>

          <GlassPanel>
            <div className="text-4xl mb-4">❓</div>
            <h3 className="text-xl font-display text-secondary-fixed mb-2">
              Câu Hỏi Nhanh
            </h3>
            <p className="text-on-background/70">
              Trả lời đúng để sống sót, sai là bị loại ngay lập tức
            </p>
          </GlassPanel>

          <GlassPanel>
            <div className="text-4xl mb-4">🏆</div>
            <h3 className="text-xl font-display text-tertiary mb-2">
              Người Chiến Thắng
            </h3>
            <p className="text-on-background/70">
              Người cuối cùng sống sót sẽ trở thành nhà vô địch
            </p>
          </GlassPanel>
        </div>
      </div>
    </main>
  );
}
