import { Button } from "@/components/ui/button";
import { ArrowLeft, Compass, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/");
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-accent text-accent-foreground flex items-center justify-center">
            <Compass className="h-7 w-7" aria-hidden="true" />
          </div>
        </div>

        <p className="num text-sm font-medium tracking-widest text-primary mb-3">404</p>

        <h1 className="text-2xl font-semibold text-foreground mb-3">页面不存在</h1>

        <p className="text-sm text-muted-foreground leading-relaxed mb-10">
          你访问的页面可能已被移动或删除，
          <br />
          也可能是链接地址有误。
        </p>

        <div
          id="not-found-button-group"
          className="flex flex-col-reverse sm:flex-row gap-3 justify-center"
        >
          <Button variant="outline" size="lg" className="min-h-11" onClick={handleGoBack}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            返回上一页
          </Button>
          <Button size="lg" className="min-h-11" onClick={() => setLocation("/")}>
            <Home className="w-4 h-4" aria-hidden="true" />
            回到工作台
          </Button>
        </div>
      </div>
    </div>
  );
}
