import type { NavigateOptions } from "react-router-dom";

import { HeroUIProvider } from "@heroui/system";
import { useHref, useNavigate } from "react-router-dom";
import { ToastProvider } from "@/components/ui";

declare module "@react-types/shared" {
    interface RouterConfig {
        routerOptions: NavigateOptions;
    }
}

export function Provider({ children }: { children: React.ReactNode }) {
    const navigate = useNavigate();
    return (
        <HeroUIProvider navigate={navigate} useHref={useHref} disableAnimation>
            <ToastProvider placement="top-center" toastProps={{ timeout: 6000, classNames: { base: "w-[480px] max-w-[calc(100vw-2rem)] border border-ink-200 dark:border-white/10", title: "font-bold" } }} />
            {children}
        </HeroUIProvider>
    );
}
