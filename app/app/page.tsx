import Link from "next/link";

export default function Inicio() {
  return (
    <>
      <h1>¿Qué querés hacer?</h1>
      <div className="home">
        <Link href="/carga">Carga (depósito)</Link>
        <Link href="/deposito">Depósito: lo guardado</Link>
        <Link href="/mover">Mover stock entre sucursales</Link>
        <Link href="/ingreso">Ingreso (local)</Link>
        <Link href="/venta">Venta</Link>
        <Link href="/buscar">Buscar producto</Link>
      </div>
    </>
  );
}
