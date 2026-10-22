"use client";

import { useId, useState } from "react";
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { ListPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

/**
 * The row menu from the approved Explorer: edit the holding, log a trade for it, or remove it
 * (which asks first, in its own dialog). One 44px target, labelled with the ticker.
 */
export function HoldingMenu({
  ticker,
  onEdit,
  onLogTrade,
  onRemove,
}: {
  ticker: string;
  onEdit: () => void;
  onLogTrade: () => void;
  onRemove: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();
  const choose = (action: () => void) => () => {
    setAnchor(null);
    action();
  };
  return (
    <>
      <IconButton
        aria-label={`Actions for ${ticker}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-controls={anchor !== null ? id : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ width: 44, height: 44, color: "var(--muted)", flex: "none" }}
      >
        <MoreHorizontal size={18} />
      </IconButton>
      <Menu id={id} anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { minWidth: 190, borderRadius: "14px" } } }}>
        <MenuItem onClick={choose(onEdit)} sx={{ minHeight: 44 }}>
          <ListItemIcon>
            <Pencil size={16} />
          </ListItemIcon>
          <ListItemText>Edit holding</ListItemText>
        </MenuItem>
        <MenuItem onClick={choose(onLogTrade)} sx={{ minHeight: 44 }}>
          <ListItemIcon>
            <ListPlus size={16} />
          </ListItemIcon>
          <ListItemText>Log a trade</ListItemText>
        </MenuItem>
        <MenuItem onClick={choose(onRemove)} sx={{ minHeight: 44 }}>
          <ListItemIcon>
            <Trash2 size={16} />
          </ListItemIcon>
          <ListItemText>Remove holding</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
