import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function ToastExample() {
  const { toast } = useToast();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={() => {
            toast({
              title: "Thông báo",
              description: "Đây là một thông báo thông thường.",
            });
          }}
        >
          Show Info Toast
        </Button>

        <Button
          variant="secondary"
          onClick={() => {
            toast({
              title: "Thành công!",
              description: "Hành động của bạn đã được thực hiện thành công.",
              variant: "success",
            });
          }}
        >
          Show Success Toast
        </Button>

        <Button
          variant="ghost"
          onClick={() => {
            toast({
              title: "Cảnh báo",
              description: "Đây là một cảnh báo cần chú ý.",
              variant: "warning",
            });
          }}
        >
          Show Warning Toast
        </Button>

        <Button
          variant="danger"
          onClick={() => {
            toast({
              title: "Lỗi",
              description: "Đã xảy ra lỗi trong quá trình thực hiện hành động.",
              variant: "error",
            });
          }}
        >
          Show Error Toast
        </Button>
      </div>
    </div>
  );
}
