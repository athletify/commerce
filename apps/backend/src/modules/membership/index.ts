import { Module } from "@medusajs/framework/utils";
import MembershipModuleService from "./service";

export const MEMBERSHIP_MODULE = "membership";
export default Module(MEMBERSHIP_MODULE, { service: MembershipModuleService });
