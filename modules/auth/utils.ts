//import "server-only";
import {cookies as getCookies} from "next/headers";
//import { AUTH_COOKIE } from "./constants";

interface Props{
    prefix:string;
    value:string;
};

export const generateAuthCookie = async({
    prefix,
    value,
}: Props) =>{
    
    const cookies = await getCookies();
      cookies.set({
        name: `${prefix}-token`,
        value: value,
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
}