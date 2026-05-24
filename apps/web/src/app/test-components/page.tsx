"use client";

import React from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icon";
import { Divider } from "@/components/ui/divider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { FormField } from "@/components/ui/form-field";
import { Tooltip } from "@/components/ui/tooltip";
import { Modal } from "@/components/ui/modal";

import { useToast } from "@/hooks/use-toast";
import {
  Heart,
  Star,
  User,
  Settings,
  Plus,
  Check,
  X,
  HelpCircle,
  Mail,
  Lock,
} from "lucide-react";

export default function TestComponentsPage() {
  const [buttonLoading, setButtonLoading] = React.useState(false);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const { toast } = useToast();

  const handleLoadingClick = () => {
    setButtonLoading(true);
    const timeout = setTimeout(() => {
      setButtonLoading(false);
    }, 2000);
    return () => clearTimeout(timeout);
  };

  const showToast = (variant: "info" | "success" | "warning" | "error") => {
    const messages = {
      info: "This is an informational toast message.",
      success: "Operation completed successfully!",
      warning: "This is a warning message.",
      error: "An error occurred while processing your request.",
    };

    toast({
      title: variant.charAt(0).toUpperCase() + variant.slice(1),
      description: messages[variant as keyof typeof messages],
      variant: variant,
    });
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-12">
        <h1 className="text-4xl font-display text-primary">Test Components</h1>

        {/* Icon Component */}
        <GlassPanel>
          <h2 className="text-2xl font-display mb-4 text-secondary-fixed">
            Icons
          </h2>
          <div className="flex items-center gap-4">
            <Icon icon={Heart} size="sm" className="text-error" />
            <Icon icon={Star} size="md" className="text-tertiary" />
            <Icon icon={User} size="lg" className="text-primary" />
            <Icon icon={Settings} size="xl" className="text-secondary-fixed" />
          </div>
        </GlassPanel>

        <Divider glow />

        {/* Spinner Component */}
        <GlassPanel>
          <h2 className="text-2xl font-display mb-4 text-secondary-fixed">
            Spinners
          </h2>
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center gap-2">
              <Spinner size="sm" className="text-primary" />
              <span className="text-sm text-on-background">Small</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Spinner size="md" className="text-secondary-fixed" />
              <span className="text-sm text-on-background">Medium</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Spinner size="lg" className="text-tertiary" />
              <span className="text-sm text-on-background">Large</span>
            </div>
          </div>
        </GlassPanel>

        <Divider />

        {/* Skeleton Component */}
        <GlassPanel>
          <h2 className="text-2xl font-display mb-4 text-secondary-fixed">
            Skeletons
          </h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Skeleton variant="circle" width="40px" height="40px" />
              <Skeleton variant="text" className="w-32" />
            </div>
            <Skeleton variant="rect" className="w-full h-24" />
            <div className="space-y-2">
              <Skeleton variant="text" className="w-full" />
              <Skeleton variant="text" className="w-5/6" />
              <Skeleton variant="text" className="w-3/4" />
            </div>
          </div>
        </GlassPanel>

        <Divider glow />

        {/* GlassPanel Component */}
        <div className="space-y-6">
          <h2 className="text-2xl font-display text-secondary-fixed">
            Glass Panels
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <GlassPanel>
              <h3 className="text-xl font-display mb-2 text-primary">
                Default
              </h3>
              <p className="text-on-background">
                Default glass panel with primary border
              </p>
            </GlassPanel>

            <GlassPanel variant="secondary">
              <h3 className="text-xl font-display mb-2 text-secondary-fixed">
                Secondary
              </h3>
              <p className="text-on-background">
                Secondary glass panel with cyan border
              </p>
            </GlassPanel>

            <GlassPanel variant="elevated">
              <h3 className="text-xl font-display mb-2 text-tertiary">
                Elevated
              </h3>
              <p className="text-on-background">
                Elevated panel with solid background
              </p>
            </GlassPanel>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <GlassPanel glow="none">
              <p className="text-on-background text-sm">No Glow</p>
            </GlassPanel>
            <GlassPanel glow="primary">
              <p className="text-on-background text-sm">Primary Glow</p>
            </GlassPanel>
            <GlassPanel glow="secondary">
              <p className="text-on-background text-sm">Secondary Glow</p>
            </GlassPanel>
            <GlassPanel glow="tertiary">
              <p className="text-on-background text-sm">Tertiary Glow</p>
            </GlassPanel>
            <GlassPanel glow="error">
              <p className="text-on-background text-sm">Error Glow</p>
            </GlassPanel>
          </div>
        </div>

        <Divider />

        {/* Divider Component */}
        <GlassPanel>
          <h2 className="text-2xl font-display mb-4 text-secondary-fixed">
            Dividers
          </h2>
          <div className="space-y-4">
            <div>
              <p className="text-on-background mb-2">Horizontal Divider</p>
              <Divider />
            </div>
            <div>
              <p className="text-on-background mb-2">
                Glowing Horizontal Divider
              </p>
              <Divider glow />
            </div>
          </div>
        </GlassPanel>

        <Divider glow />

        {/* Button Component */}
        <div className="space-y-6">
          <h2 className="text-2xl font-display text-secondary-fixed">
            Buttons
          </h2>

          {/* Variants */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">Variants</h3>
            <div className="flex flex-wrap gap-4 items-center">
              <Button variant="action">Action</Button>
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="icon">
                <Plus className="w-5 h-5" />
              </Button>
            </div>
          </GlassPanel>

          {/* Sizes */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">Sizes</h3>
            <div className="flex items-center gap-4">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </div>
          </GlassPanel>

          {/* States */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">States</h3>
            <div className="flex flex-wrap gap-4 items-center">
              <Button onClick={handleLoadingClick} isLoading={buttonLoading}>
                {buttonLoading ? "Loading..." : "Click to Load"}
              </Button>
              <Button disabled>Disabled</Button>
              <Button leftIcon={Plus}>Left Icon</Button>
              <Button rightIcon={Check}>Right Icon</Button>
              <Button fullWidth className="mt-4">
                Full Width
              </Button>
            </div>
          </GlassPanel>
        </div>

        <Divider />

        {/* Input Component */}
        <div className="space-y-6">
          <h2 className="text-2xl font-display text-secondary-fixed">Inputs</h2>

          {/* Variants */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <GlassPanel>
              <h3 className="text-xl font-display mb-4 text-primary">
                Default Variant
              </h3>
              <div className="space-y-4">
                <Input placeholder="Default input" />
                <Input placeholder="With label" label="Username" />
                <Input
                  placeholder="Error state"
                  error
                  errorMessage="This field is required"
                />
                <Input placeholder="Success state" success />
              </div>
            </GlassPanel>

            <GlassPanel>
              <h3 className="text-xl font-display mb-4 text-primary">
                Terminal Variant
              </h3>
              <div className="space-y-4">
                <Input variant="terminal" placeholder="Terminal input" />
                <Input
                  variant="terminal"
                  placeholder="With label"
                  label="Room Code"
                />
                <Input
                  variant="terminal"
                  placeholder="Error state"
                  error
                  errorMessage="Invalid code"
                />
                <Input variant="terminal" placeholder="Success state" success />
              </div>
            </GlassPanel>
          </div>

          {/* Sizes */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">Sizes</h3>
            <div className="space-y-4">
              <Input inputSize="sm" placeholder="Small input" label="Small" />
              <Input inputSize="md" placeholder="Medium input" label="Medium" />
              <Input inputSize="lg" placeholder="Large input" label="Large" />
            </div>
          </GlassPanel>
        </div>

        <Divider glow />

        {/* Badge Component */}
        <div className="space-y-6">
          <h2 className="text-2xl font-display text-secondary-fixed">Badges</h2>

          {/* Variants */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">Variants</h3>
            <div className="flex flex-wrap gap-4 items-center">
              <Badge variant="default">Default</Badge>
              <Badge variant="online">Online</Badge>
              <Badge variant="eliminated">Eliminated</Badge>
              <Badge variant="admin">Admin</Badge>
              <Badge variant="warning">Warning</Badge>
            </div>
          </GlassPanel>

          {/* Sizes */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">Sizes</h3>
            <div className="flex items-center gap-4">
              <Badge size="sm">Small</Badge>
              <Badge size="md">Medium</Badge>
              <Badge size="lg">Large</Badge>
            </div>
          </GlassPanel>

          {/* With Glow */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">
              With Glow Effect
            </h3>
            <div className="flex flex-wrap gap-4 items-center">
              <Badge variant="online" glow>
                Online
              </Badge>
              <Badge variant="eliminated" glow>
                Eliminated
              </Badge>
              <Badge variant="admin" glow>
                Admin
              </Badge>
              <Badge variant="warning" glow>
                Warning
              </Badge>
            </div>
          </GlassPanel>

          {/* With Icons */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">
              With Icons
            </h3>
            <div className="flex flex-wrap gap-4 items-center">
              <Badge variant="online" icon={Check}>
                Online
              </Badge>
              <Badge variant="eliminated" icon={X}>
                Eliminated
              </Badge>
              <Badge variant="admin" icon={Star}>
                Admin
              </Badge>
            </div>
          </GlassPanel>
        </div>

        <Divider />

        {/* Avatar Component */}
        <div className="space-y-6">
          <h2 className="text-2xl font-display text-secondary-fixed">
            Avatars
          </h2>

          {/* Sizes */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">Sizes</h3>
            <div className="flex items-center gap-6">
              <Avatar size="xs" fallback="U" />
              <Avatar size="sm" fallback="User" />
              <Avatar size="md" fallback="Player" />
              <Avatar size="lg" fallback="Gamer" />
              <Avatar size="xl" fallback="Admin" />
            </div>
          </GlassPanel>

          {/* With Images */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">
              With Images
            </h3>
            <div className="flex items-center gap-6">
              <Avatar
                src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                alt="User avatar"
                fallback="JD"
              />
              <Avatar
                src="https://images.unsplash.com/photo-1517841905240-472988babdf9?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                alt="User avatar"
                fallback="AS"
              />
              <Avatar
                src="invalid-url.jpg"
                alt="Broken image"
                fallback="Fallback"
              />
            </div>
          </GlassPanel>

          {/* With Status */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">
              With Status Indicators
            </h3>
            <div className="flex items-center gap-6">
              <Avatar size="lg" fallback="Online" status="online" />
              <Avatar size="lg" fallback="Offline" status="offline" />
              <Avatar size="lg" fallback="Eliminated" status="eliminated" />
            </div>
          </GlassPanel>

          {/* With Glow */}
          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">
              With Glow Effects
            </h3>
            <div className="flex items-center gap-6">
              <Avatar size="lg" fallback="P1" glow="primary" />
              <Avatar size="lg" fallback="P2" glow="secondary" />
              <Avatar size="lg" fallback="P3" glow="tertiary" />
              <Avatar size="lg" fallback="P4" glow="error" />
            </div>
          </GlassPanel>
        </div>

        <Divider glow />

        {/* FormField Component */}
        <div className="space-y-6">
          <h2 className="text-2xl font-display text-secondary-fixed">
            Form Fields
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <GlassPanel>
              <h3 className="text-xl font-display mb-4 text-primary">
                Basic Form Field
              </h3>
              <div className="space-y-4">
                <FormField label="Email" id="email">
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email"
                  />
                </FormField>

                <FormField label="Username" id="username">
                  <Input id="username" placeholder="Choose a username" />
                </FormField>
              </div>
            </GlassPanel>

            <GlassPanel>
              <h3 className="text-xl font-display mb-4 text-primary">
                With Validation
              </h3>
              <div className="space-y-4">
                <FormField
                  label="Email"
                  id="email-error"
                  error="Please enter a valid email address"
                >
                  <Input
                    id="email-error"
                    type="email"
                    placeholder="Enter your email"
                    error
                  />
                </FormField>

                <FormField
                  label="Password"
                  id="password-error"
                  error="Password must be at least 8 characters"
                >
                  <Input
                    id="password-error"
                    type="password"
                    placeholder="Enter your password"
                    error
                  />
                </FormField>
              </div>
            </GlassPanel>
          </div>
        </div>

        <Divider />

        {/* Tooltip Component */}
        <div className="space-y-6">
          <h2 className="text-2xl font-display text-secondary-fixed">
            Tooltips
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <GlassPanel>
              <h3 className="text-xl font-display mb-4 text-primary">
                Basic Tooltips
              </h3>
              <div className="flex flex-wrap gap-4 items-center">
                <Tooltip content="This is helpful information">
                  <Button variant="icon">
                    <HelpCircle className="w-5 h-5" />
                  </Button>
                </Tooltip>

                <Tooltip content="Send message">
                  <Button variant="icon">
                    <Mail className="w-5 h-5" />
                  </Button>
                </Tooltip>

                <Tooltip content="Secure connection">
                  <Button variant="icon">
                    <Lock className="w-5 h-5" />
                  </Button>
                </Tooltip>
              </div>
            </GlassPanel>

            <GlassPanel>
              <h3 className="text-xl font-display mb-4 text-primary">
                Positioning
              </h3>
              <div className="flex flex-wrap gap-4 items-center">
                <Tooltip content="Tooltip on top" side="top">
                  <Button size="sm">Top</Button>
                </Tooltip>

                <Tooltip content="Tooltip on bottom" side="bottom">
                  <Button size="sm">Bottom</Button>
                </Tooltip>

                <Tooltip content="Tooltip on left" side="left">
                  <Button size="sm">Left</Button>
                </Tooltip>

                <Tooltip content="Tooltip on right" side="right">
                  <Button size="sm">Right</Button>
                </Tooltip>
              </div>
            </GlassPanel>
          </div>
        </div>

        <Divider glow />

        {/* Toast Component */}
        <div className="space-y-6">
          <h2 className="text-2xl font-display text-secondary-fixed">Toasts</h2>

          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">
              Toast Variants
            </h3>
            <div className="flex flex-wrap gap-4 items-center">
              <Button onClick={() => showToast("info")}>Info Toast</Button>
              <Button onClick={() => showToast("success")} variant="primary">
                Success Toast
              </Button>
              <Button onClick={() => showToast("warning")} variant="secondary">
                Warning Toast
              </Button>
              <Button onClick={() => showToast("error")} variant="danger">
                Error Toast
              </Button>
            </div>
          </GlassPanel>
        </div>

        <Divider />

        {/* Modal Component */}
        <div className="space-y-6">
          <h2 className="text-2xl font-display text-secondary-fixed">Modals</h2>

          <GlassPanel>
            <h3 className="text-xl font-display mb-4 text-primary">
              Modal Examples
            </h3>
            <div className="flex flex-wrap gap-4">
              <Button onClick={() => setIsModalOpen(true)}>
                Open Basic Modal
              </Button>
            </div>

            <Modal
              open={isModalOpen}
              onOpenChange={setIsModalOpen}
              title="Sample Modal"
              description="This is a demonstration of the modal component."
            >
              <div className="space-y-4">
                <p className="text-on-background">
                  This modal uses the GlassPanel component for its styling,
                  giving it the distinctive glass effect that fits with the rest
                  of the UI components.
                </p>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setIsModalOpen(false)}>Confirm</Button>
                </div>
              </div>
            </Modal>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
