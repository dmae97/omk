/**
 * Process management utilities.
 */

import { setNativeKillTree } from "@oh-my-pi/pi-utils";
import { native } from "../native";

setNativeKillTree(native.killTree);

export const { killTree, listDescendants } = native;
