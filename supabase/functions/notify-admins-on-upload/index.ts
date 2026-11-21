// No package registry or external SDK is required to boot the existing signed-upload endpoint.
import { uploadEndpoint } from './handler.mjs';
Deno.serve(uploadEndpoint((name: string) => Deno.env.get(name)));
