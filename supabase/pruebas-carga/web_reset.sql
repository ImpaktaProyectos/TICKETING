delete from ticket_web_entradas where numero > 8000;
delete from ticket_web_pedidos where codigo !~ '^P[0-9]+$';
update ticket_web_eventos set contador = 8000; update ticket_web_tramos set vendidas = 8000;
vacuum analyze ticket_web_entradas; vacuum analyze ticket_web_pedidos;
