"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Typography } from "@mui/material";
import { DESKTOP_SECTIONS, isActive, type NavItem } from "./navItems";
import { BrandMark } from "@/components/auth/AuthShell";
import type { Role } from "@/lib/auth/session";

const spring = "cubic-bezier(0.22, 1, 0.36, 1)";

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  const items = DESKTOP_SECTIONS.filter(
    (item: NavItem) => !item.adminOnly || role === "admin",
  );

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={{
        width: 210,
        flex: "none",
        borderRight: "1px solid var(--line)",
        display: { xs: "none", md: "flex" },
        flexDirection: "column",
        gap: 0.5,
        p: "22px 14px",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 1,
          pb: 2,
        }}
      >
        <BrandMark size={34} />
        <Typography
          sx={{
            fontSize: "1rem",
            fontWeight: 650,
            letterSpacing: "-0.01em",
          }}
        >
          trade-agent
        </Typography>
      </Box>

      {items.map((item) => {
        const Icon = item.icon;
        const on = isActive(pathname, item.href, item.exact);

        const link = (
          <Box
            component={Link}
            href={item.href}
            aria-current={on ? "page" : undefined}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: item.sub ? "7px 12px" : "10px 12px",
              borderRadius: "12px",
              fontSize: item.sub ? "0.78125rem" : "0.875rem",
              fontWeight: on ? 600 : 400,
              textDecoration: "none",
              position: "relative",
              WebkitTapHighlightColor: "transparent",

              color: on ? "var(--accent)" : "var(--muted)",
              backgroundColor: on ? "var(--panel)" : "transparent",
              boxShadow: on ? "var(--shadow)" : "none",

              transform: "translateX(0) scale(1)",
              transformOrigin: "center",

              transition: `
                background-color 240ms ease,
                color 240ms ease,
                box-shadow 300ms ease,
                transform 380ms ${spring}
              `,

              "& .nav-icon": {
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
                transition: `transform 380ms ${spring}, color 240ms ease`,
              },

              // HOVER
              "@media (hover: hover)": {
                "&:hover": {
                  backgroundColor: "var(--panel)",
                  color: "var(--accent)",
                  boxShadow: "var(--shadow)",
                  transform: "translateX(3px)",

                  "& .nav-icon": {
                    transform: "translateX(2px) scale(1.06)",
                  },
                },
              },

              // KEYBOARD FOCUS
              "&:focus-visible": {
                outline: "2px solid var(--accent)",
                outlineOffset: "3px",
                backgroundColor: "var(--panel)",
                color: "var(--accent)",
              },

              // CLICK / PRESS
              "&:active": {
                transform: "scale(0.975)",
                backgroundColor: "var(--panel)",
                transitionDuration: "110ms",
                transitionTimingFunction: "ease-out",

                "& .nav-icon": {
                  transform: "scale(0.94)",
                  transitionDuration: "110ms",
                },
              },

              // REDUCED MOTION ACCESSIBILITY
              "@media (prefers-reduced-motion: reduce)": {
                transition: "none",
                transform: "none",

                "& .nav-icon, &:hover .nav-icon, &:active .nav-icon": {
                  transition: "none",
                  transform: "none",
                },

                "&:hover, &:active": {
                  transform: "none",
                },
              },
            }}
          >
            <Box component="span" className="nav-icon">
              <Icon size={item.sub ? 15 : 18} strokeWidth={1.75} />
            </Box>

            {item.label}
          </Box>
        );

        return (
          <Fragment key={item.href}>
            {item.section && (
              <Typography
                sx={{
                  fontSize: "0.75rem",
                  color: "var(--muted)",
                  px: 1.5,
                  pt: 2,
                  pb: 0.5,
                }}
              >
                {item.section}
              </Typography>
            )}

            {item.sub ? (
              <Box
                sx={{
                  ml: "13px",
                  pl: "8px",
                  borderLeft: "1px solid var(--line2)",
                }}
              >
                {link}
              </Box>
            ) : (
              link
            )}
          </Fragment>
        );
      })}

      <Box sx={{ flex: 1 }} />
    </Box>
  );
}
